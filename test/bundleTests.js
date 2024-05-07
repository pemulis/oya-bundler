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
describe('publishToIPFS', function() {
  let validSignature, invalidSignature;
  const bundlerAddress = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf';
  const wrongAddress = '0x3526e4f3E4EC41E7Ff7743F986FCEBd3173F657E';
  const validData = '{ content: "Hello, IPFS!" }';
  const validCID = "bafkreiciu52bu6glz3izmbsmb2mxfgsnwsezopw2qmupsh5zzp545rrwiq";

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
    console.log("CID: ", cid.toString());
    expect(cid.toString()).to.equal(validCID);

    const result = await redis.zrange('cids', 0, -1);
    console.log("Result: ", result);
    expect(result).to.include(cid.toString());
  });

  afterEach(() => {
    sinon.restore();
  });
});
