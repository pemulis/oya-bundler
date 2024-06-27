const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { handleIntention, createAndPublishBundle, cachedIntentions, _clearCachedIntentions } = require('../handlers');
const { Wallet } = require('ethers');

describe('Handle intentions and publish bundles', function() {
  this.timeout(60000); // Set timeout to 60 seconds (60000ms)
  let accountHolderSignatureOnIntention, accountHolderSignatureOnSwapIntention;
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
  const bundleCID = "bafkreid2jfyvawbqj3thmm44wow4uuwoztb6y4a7rpl3crtt2s26exqv3i";
  const bundlerPrivateKey = '5267abf88fb9cf13333eb73ae7c06fa06d2580fd70324b116bf4fa2a3a5f431b'; // Only used for testing
  const accountHolderPrivateKey = '1a7237e38d7f2c46c8593b72e17f830d69fc0ac4661025cf8d4242973769afed';

  before(async () => {
    accountHolderSignatureOnIntention = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(intention));
    accountHolderSignatureOnSwapIntention = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(swapIntention));

    // Stub the IPFS add method
    let heliaAddStub = sinon.stub().resolves(bundleCID);
    global.s = { add: heliaAddStub };

    // Ensure brian is initialized
    if (!global.brian) {
      const { BrianSDK } = await import('@brian-ai/sdk');
      const options = {
        apiKey: process.env.BRIAN_API_KEY,
        apiUrl: process.env.BRIAN_API_URL,
      };
      global.brian = new BrianSDK(options);
      // Wait for brian to initialize
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  afterEach(() => {
    sinon.restore();
    _clearCachedIntentions(); // Clear cached intentions after each test
  });

  it('should throw an error if account holder signature verification fails', async () => {
    const fakeSignature = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(intention)); // Using a wrong signature
    await expect(handleIntention(intention, fakeSignature, accountHolderAddress))
      .to.be.rejectedWith("Signature verification failed");
  });

  it('should cache execution objects if account holder signature verification succeeds', async () => {
    const authorizedTesterSignature = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(intention));
    await handleIntention(intention, accountHolderSignatureOnIntention, accountHolderAddress);
    console.log('Cached intentions in test:', cachedIntentions); // Debug log
    expect(cachedIntentions.length).to.equal(1);
    expect(cachedIntentions[0].execution[0].intention).to.deep.equal(intention);
  });

  it('should create and publish a bundle with cached execution objects', async () => {
    const accountHolderSignature1 = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(intention));
    const accountHolderSignature2 = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(swapIntention));
    // Add both intentions to cache
    await handleIntention(intention, accountHolderSignature1, accountHolderAddress);
    await handleIntention(swapIntention, accountHolderSignature2, accountHolderAddress);

    // Manually trigger bundle creation and publishing
    await createAndPublishBundle();

    // Verify that the cache is empty after publishing
    console.log('Cached intentions after bundling in test:', cachedIntentions); // Debug log
    expect(cachedIntentions.length).to.equal(0);

    // Verify that the published bundle includes both execution objects
    expect(global.s.add.calledOnce).to.be.true;
    const publishedBundle = JSON.parse(global.s.add.firstCall.args[0]);
    expect(publishedBundle.bundle.length).to.equal(2);

    const [firstExecution, secondExecution] = publishedBundle.bundle;
    expect(firstExecution.intention).to.deep.equal(intention);
    expect(secondExecution.intention).to.deep.equal(swapIntention);
  });
});
