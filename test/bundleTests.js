const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { publishToIPFS, getLatestBundle, getCIDsByTimestamp, setRedisClient } = require('../handlers');
const ethers = require('ethers');

const RedisMock = require('redis-mock');
const redisMock = RedisMock.createClient();

describe('publishToIPFS', function() {
  const bundlerAddress = '0xbundler';
  const fakeData = { content: "Hello, IPFS!" };
  const fakeSignature = "0xsignature";
  const fakeCID = "QmTestCid";

  // Stub for Helia's add method
  let heliaAddStub;

  before(() => {
    setRedisClient(redisMock);
    global.BUNDLER_ADDRESS = bundlerAddress; // Set the global BUNDLER_ADDRESS
    heliaAddStub = sinon.stub().resolves(fakeCID);
    global.s = { add: heliaAddStub }; // Stub s.add
  });

  beforeEach(async () => {
    await redisMock.flushall();
  });

  it('should throw an error if the caller is not the bundler', async () => {
    const unauthorizedFrom = '0xnotBundler';
    await expect(publishToIPFS(fakeData, fakeSignature, unauthorizedFrom))
      .to.be.rejectedWith("Unauthorized: Only the bundler can publish new bundles.");
  });

  it('should throw an error if the signature verification fails', async () => {
    sinon.stub(ethers.utils, 'verifyMessage').returns('0xwrongAddress');
    await expect(publishToIPFS(fakeData, fakeSignature, bundlerAddress))
      .to.be.rejectedWith("Signature verification failed");
  });

  it('should publish data to IPFS and store the CID if authorized and the signature is valid', async () => {
    sinon.stub(ethers.utils, 'verifyMessage').returns(bundlerAddress);
    const cid = await publishToIPFS(fakeData, fakeSignature, bundlerAddress);
    expect(cid).to.equal(fakeCID);

    const result = await redisMock.zrange('cids', 0, -1);
    expect(result).to.include(cid);
  });

  afterEach(() => {
    sinon.restore();
  });
});
