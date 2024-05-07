const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { publishToIPFS, setRedisClient, getLatestBundle, getCIDsByTimestamp } = require('../handlers');
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
  let validSignature, invalidSignature;
  const bundlerAddress = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf';
  const wrongAddress = '0x3526e4f3E4EC41E7Ff7743F986FCEBd3173F657E';
  const validData = '{[{"Transfer 1 ETH to alice.eth", bob.eth, 0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf, 2346265198, 1}], [{proof goes here}], 1715113198, 42}';
  const validCID = "bafkreid6ueroyvqz4bq5svdxqw4kbedyt33srwqrep6eufagrhpi2o272q";

  before(async () => {
    setRedisClient(redis);
    const bundlerPrivateKey = '5267abf88fb9cf13333eb73ae7c06fa06d2580fd70324b116bf4fa2a3a5f431b'; // Only used for testing
    const wrongPrivateKey = '1a7237e38d7f2c46c8593b72e17f830d69fc0ac4661025cf8d4242973769afed';
    validSignature = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(validData));
    invalidSignature = await new Wallet(wrongPrivateKey).signMessage(JSON.stringify(validData));

    let heliaAddStub = sinon.stub().resolves(validCID);
    global.s = { add: heliaAddStub };
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  it('should throw an error if the caller is not the bundler', async () => {
    const unauthorizedFrom = wrongAddress;
    await expect(publishToIPFS(validData, validSignature, unauthorizedFrom))
      .to.be.rejectedWith("Unauthorized: Only the bundler can publish new bundles.");
  });

  it('should throw an error if the signature verification fails', async () => {
    try {
      await expect(publishToIPFS(validData, invalidSignature, bundlerAddress))
        .to.be.rejectedWith("Signature verification failed");
    } catch (error) {
      console.error("Error caught in test: ", error);
      throw error; // Re-throw to ensure test fails as expected
    } finally {
      sinon.restore();
    }
  });  

  it('should publish data to IPFS and return the CID if authorized and the signature is valid', async () => {
    const cid = await publishToIPFS(validData, validSignature, bundlerAddress);
    expect(cid.toString()).to.equal(validCID);

    const result = await redis.zrange('cids', 0, -1);
    expect(result).to.include(cid.toString());
  });

  it('should return the latest CID if available', async () => {
    const timestamp = Date.now();
    await redis.zadd('cids', timestamp, validCID); // Prepopulate Redis with a known CID
    const bundle = await getLatestBundle();
    expect(bundle).to.deep.equal({ ipfsPath: validCID });
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

  afterEach(() => {
    sinon.restore();
  });
});
