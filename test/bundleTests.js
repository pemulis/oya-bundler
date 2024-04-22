const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const expect = chai.expect;
chai.use(chaiAsPromised);

const { storeCID, getLatestBundle, getCIDsByTimestamp, setRedisClient } = require('../handlers');

const RedisMock = require('redis-mock');
const redisMock = RedisMock.createClient();

describe('Bundle Management', () => {
  beforeEach(async () => {
    setRedisClient(redisMock);
    await redisMock.flushall();  // Clear all data before each test to ensure a clean slate
  });

  describe('storeCID', () => {
    it('should store a CID with the current timestamp', async () => {
      console.log("storeCID test", redisMock);
      const cid = 'QmTestCid';
      await storeCID(cid);
      const result = await redisMock.zrange('cids', 0, -1);  // Ensure this is awaited
      console.log("result", result);
      expect(result).to.include(cid);
    });
});

  // describe('getLatestBundle', () => {
  //   it('should retrieve the latest CID', async () => {
  //     console.log("getLatestBundle test", redisMock);
  //     const cid1 = 'QmTestCid1';
  //     const cid2 = 'QmTestCid2';
  //     await storeCID(cid1);
  //     await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
  //     await storeCID(cid2);
  //     const latest = await getLatestBundle();
  //     console.log("latest", latest);
  //     expect(latest.ipfsPath).to.equal(cid2);
  //   });
  // });

  // describe('getCIDsByTimestamp', () => {
  //   it('should retrieve all CIDs within a specific timestamp range', async () => {
  //     console.log("getCIDsByTimestamp test", redisMock);
  //     const cid1 = 'QmTestCid1';
  //     const start = Date.now();
  //     await storeCID(cid1);
  //     await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
  //     const end = Date.now();
  //     const cid2 = 'QmTestCid2';
  //     await storeCID(cid2);

  //     const cids = await getCIDsByTimestamp(start, end);
  //     console.log("cids", cids);
  //     expect(cids).to.deep.include({ timestamp: start, ipfsPath: cid1 });
  //     expect(cids).to.not.deep.include({ ipfsPath: cid2 });
  //   });
  // });
});
