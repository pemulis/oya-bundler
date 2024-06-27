const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { publishBundle, handleIntention } = require('../handlers');
const { Wallet } = require('ethers');

// Let's run some tests!
describe('Handle intentions and publish bundles', function() {
  this.timeout(60000); // Set timeout to 60 seconds (60000ms)
  let bundlerSignatureOnBundle, accountHolderSignatureOnBundle, accountHolderSignatureOnIntention;
  const bundlerAddress = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf';
  const accountHolderAddress = '0x3526e4f3E4EC41E7Ff7743F986FCEBd3173F657E';
  const intention = {
    action: "Transfer 1 ETH to alice.eth on Ethereum",
    from: accountHolderAddress,
    bundler: bundlerAddress,
    expiry: 2346265198,
    nonce: 1
  };
  const swapIntention = {
    action: "Swap 0.5 ETH for USDC on Ethereum",
    from: accountHolderAddress,
    bundler: bundlerAddress,
    expiry: 2346265198,
    nonce: 2
  };
  const bundle = {
        intention: intention,
        // proof below updates balances on the virtual chain, using locked assets
        // proof may require multiple virtual token transfers, but this has just one
        proof: [{
          token: "0x0000000000000000000000000000000000000000", // null address means ETH
          chainId: 1,
          from: accountHolderAddress,
          to: "alice.eth",
          amount: 1000000000000000000, // 1 ETH
          tokenId: 0 // no token ID for ETH, this field used for NFTs
        }]
      };
  const bundleData = {
    bundle: [bundle],
    nonce: 42
  };
  const bundleCID = "bafkreid2jfyvawbqj3thmm44wow4uuwoztb6y4a7rpl3crtt2s26exqv3i";
  const bundlerPrivateKey = '5267abf88fb9cf13333eb73ae7c06fa06d2580fd70324b116bf4fa2a3a5f431b'; // Only used for testing
  const accountHolderPrivateKey = '1a7237e38d7f2c46c8593b72e17f830d69fc0ac4661025cf8d4242973769afed';

  before(async () => {
    bundlerSignatureOnBundle = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(bundleData));
    accountHolderSignatureOnBundle = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(bundleData));
    bundlerSignatureOnIntention = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(intention));
    accountHolderSignatureOnIntention = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(intention));
    accountHolderSignatureOnSwapIntention = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(swapIntention));

    let heliaAddStub = sinon.stub().resolves(bundleCID);
    global.s = { add: heliaAddStub };
  });

  it('should throw an error if the caller is not the bundler', async () => {
    const unauthorizedFrom = accountHolderAddress;
    await expect(publishBundle(JSON.stringify(bundleData), bundlerSignatureOnBundle, unauthorizedFrom))
      .to.be.rejectedWith("Unauthorized: Only the bundler can publish new bundles.");
  });

  it('should throw an error if bundler signature verification fails', async () => {
    try {
      await expect(publishBundle(JSON.stringify(bundleData), accountHolderSignatureOnBundle, bundlerAddress))
        .to.be.rejectedWith("Signature verification failed");
    } catch (error) {
      console.error("Error caught in test: ", error);
      throw error; // Re-throw to ensure test fails as expected
    } finally {
      sinon.restore();
    }
  });  

  it('should publish data to IPFS and return the CID if authorized and the signature is valid', async () => {
    const cid = await publishBundle(JSON.stringify(bundleData), bundlerSignatureOnBundle, bundlerAddress);
    expect(cid.toString()).to.equal(bundleCID);
  });

  it('should throw error if account holder signature verification fails', async () => {
    try {
      await expect(handleIntention(intention, bundlerSignatureOnIntention, accountHolderAddress))
        .to.be.rejectedWith("Signature verification failed");
    } catch (error) {
      console.error("Error caught in test: ", error);
      throw error; // Re-throw to ensure test fails as expected
    } finally {
      sinon.restore();
    }
  });

  it('should get transaction details if account holder signature verification succeeds', async () => {
    await expect(
      handleIntention(intention, accountHolderSignatureOnIntention, accountHolderAddress)
    ).to.not.be.rejected;
    sinon.restore();
  });

  it('should publish bundle with valid intention and proof', async () => {
    // Call handleIntention to get the bundle
    const newBundle = await handleIntention(intention, accountHolderSignatureOnIntention, accountHolderAddress);

    // Generate bundler signature on the bundle data
    const bundlerSignatureOnNewBundle = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(newBundle));

    // Call publishBundle with the bundle data, bundler signature, and from address
    await publishBundle(JSON.stringify(newBundle), bundlerSignatureOnNewBundle, bundlerAddress);

    expect(newBundle.bundle[0].proof.length).to.equal(1);
  });

  it('should publish bundle with valid swap intention and proof', async () => {
    // Call handleIntention to get the bundle
    const newBundle = await handleIntention(swapIntention, accountHolderSignatureOnSwapIntention, accountHolderAddress);

    // Generate bundler signature on the bundle data
    const bundlerSignatureOnNewBundle = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(newBundle));

    // Call publishBundle with the bundle data, bundler signature, and from address
    await publishBundle(JSON.stringify(newBundle), bundlerSignatureOnNewBundle, bundlerAddress);

    expect(newBundle.bundle[0].proof.length).to.equal(2);
  });

  afterEach(() => {
    sinon.restore();
  });
});
