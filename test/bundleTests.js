const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { publishBundle, setRedisClient, getLatestBundle, getCIDsByTimestamp, handleIntention } = require('../handlers');
const { ethers, Wallet } = require('ethers');

/*
 * You'll need to have Redis installed locally for testing

 * Run the following command to install Redis, on a Mac, if you haven't already:
 * brew install redis
 * 
 * The `npm test` script will automatically start the Redis server for you
 */
const Redis = require('ioredis');
const redis = new Redis({
  host: 'localhost',  // Redis server address
  port: 6379         // Redis server port
});

// Let's run some tests!
describe('Publish to IPFS and retrieve data from Redis', function() {
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
  const proof = {
        intention: intention,
        // proof below updates balances on the virtual chain, using locked assets
        // proof may require multiple virtual token transfers, but this has just one
        proof: [{
          token: 0x0000000000000000000000000000000000000000, // null address means ETH
          chainId: 1,
          from: accountHolderAddress,
          to: "alice.eth",
          amount: 1000000000000000000, // 1 ETH
          tokenId: 0 // no token ID for ETH, this field used for NFTs
        }]
      };
  const bundleData = {
    proofs: [proof],
    nonce: 42
  };
  const bundleCID = "bafkreicqc2ssny76w3cjiffmckfuvlbp4bjxflbtzfpik4niinmxnyjsne";
  const bundlerPrivateKey = '5267abf88fb9cf13333eb73ae7c06fa06d2580fd70324b116bf4fa2a3a5f431b'; // Only used for testing
  const accountHolderPrivateKey = '1a7237e38d7f2c46c8593b72e17f830d69fc0ac4661025cf8d4242973769afed';

  before(async () => {
    setRedisClient(redis);
    bundlerSignatureOnBundle = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(bundleData));
    accountHolderSignatureOnBundle = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(bundleData));
    bundlerSignatureOnIntention = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(intention));
    accountHolderSignatureOnIntention = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(intention));
    accountHolderSignatureOnSwapIntention = await new Wallet(accountHolderPrivateKey).signMessage(JSON.stringify(swapIntention));

    let heliaAddStub = sinon.stub().resolves(bundleCID);
    global.s = { add: heliaAddStub };
  });

  beforeEach(async () => {
    await redis.flushall();
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

    const result = await redis.zrange('cids', 0, -1);
    expect(result).to.include(cid.toString());
  });

  it('should return the latest CID if available', async () => {
    const timestamp = Date.now();
    await redis.zadd('cids', timestamp, bundleCID); // Prepopulate Redis with a known CID
    const bundle = await getLatestBundle();
    expect(bundle).to.deep.equal({ ipfsPath: bundleCID });
  });

  it('should throw an error if no CIDs are available in getLatestBundle', async () => {
    await expect(getLatestBundle()).to.be.rejectedWith("No bundles available");
  });

  it('should return CIDs within the specified timestamp range', async () => {
    const startTimestamp = Date.now();
    await redis.zadd('cids', startTimestamp, 'cid123');
    const endTimestamp = startTimestamp + 1000; // Explicitly set 1 second later
    await redis.zadd('cids', endTimestamp, 'cid124');
  
    const cids = await getCIDsByTimestamp(startTimestamp, endTimestamp + 100);
  
    const expectedCIDs = [
      { timestamp: startTimestamp, ipfsPath: 'cid123' },
      { timestamp: endTimestamp, ipfsPath: 'cid124' }
    ];
  
    expect(cids.length).to.equal(expectedCIDs.length);
    expectedCIDs.forEach(expectedCID => {
      const match = cids.find(cid => cid.ipfsPath === expectedCID.ipfsPath && cid.timestamp === expectedCID.timestamp);
      expect(match).to.not.be.undefined;
    });
  });

  it('should throw an error if no CIDs are found in the specified timestamp range', async () => {
    const startTimestamp = Date.now();
    const endTimestamp = startTimestamp + 1000; // 1 second later
    await expect(getCIDsByTimestamp(startTimestamp, endTimestamp)).to.be.rejectedWith("No data found");
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
    const newCid = await publishBundle(JSON.stringify(newBundle), bundlerSignatureOnNewBundle, bundlerAddress);

    const publishedBundles = await redis.zrange('cids', 0, -1);
    expect(publishedBundles).to.include(newCid.toString());
    expect(newBundle.proofs[0].proof.length).to.equal(1);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should publish bundle with valid swap intention and proof', async () => {
    // Call handleIntention to get the bundle
    const newBundle = await handleIntention(swapIntention, accountHolderSignatureOnSwapIntention, accountHolderAddress);

    // Generate bundler signature on the bundle data
    const bundlerSignatureOnNewBundle = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(newBundle));

    // Call publishBundle with the bundle data, bundler signature, and from address
    const newCid = await publishBundle(JSON.stringify(newBundle), bundlerSignatureOnNewBundle, bundlerAddress);

    const publishedBundles = await redis.zrange('cids', 0, -1);
    expect(publishedBundles).to.include(newCid.toString());
    expect(newBundle.proofs[0].proof.length).to.equal(2);
  });

  afterEach(() => {
    sinon.restore();
  });
});
