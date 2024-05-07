const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { publishToIPFS, setRedisClient } = require('../handlers');
const { ethers, Wallet }= require('ethers');

const RedisMock = require('redis-mock');
const redisMock = RedisMock.createClient();

describe('publishToIPFS', async function() {
  const bundlerAddress = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf';  // Define bundler address for all tests
  const bundlerPrivateKey = '5267abf88fb9cf13333eb73ae7c06fa06d2580fd70324b116bf4fa2a3a5f431b'; // Only used for testing, obviously insecure
  const fakeData = { content: "Hello, IPFS!" };  // Sample data to use in tests
  const fakeSignature = await new Wallet(bundlerPrivateKey).signMessage(JSON.stringify(fakeData));
  const fakeCID = "QmTestCid";  // Define a fake CID for the tests

  // Stub for Helia's add method
  let heliaAddStub;

  before(() => {
    setRedisClient(redisMock);  // Set the mock Redis client
    heliaAddStub = sinon.stub().resolves(fakeCID);  // Stub the add method to resolve with fakeCID
    global.s = { add: heliaAddStub };  // Assign the stub to global.s.add
  });

  beforeEach(async () => {
    await redisMock.flushall();  // Flush the Redis mock before each test
  });

  it('should throw an error if the caller is not the bundler', async () => {
    const unauthorizedFrom = '0xnotBundler';  // Define an unauthorized address
    await expect(publishToIPFS(fakeData, fakeSignature, unauthorizedFrom))
      .to.be.rejectedWith("Unauthorized: Only the bundler can publish new bundles.");
  });

  it('should throw an error if the signature verification fails', async () => {
    sinon.stub(ethers, 'verifyMessage').returns('0xwrongAddress');
    await expect(publishToIPFS(fakeData, fakeSignature, bundlerAddress))
      .to.be.rejectedWith("Signature verification failed");
  });

  it('should publish data to IPFS and store the CID if authorized and the signature is valid', async () => {
    sinon.stub(ethers, 'verifyMessage').returns(bundlerAddress);
    const cid = await publishToIPFS(fakeData, fakeSignature, bundlerAddress);
    expect(cid).to.equal(fakeCID);

    const result = await redisMock.zrange('cids', 0, -1);
    expect(result).to.include(cid);
  });

  afterEach(() => {
    sinon.restore();  // Restore all stubs, mocks, and spies
  });
});
