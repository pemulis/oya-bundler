const ethers = require('ethers');
const Redis = require('ioredis');

// Lazy-load redis client
let redis;

// Allow testing environment to inject a mock Redis, or use a real one
function setRedisClient(customClient) {
  redis = customClient;
}

// Variables for Helia instances
let createHelia, strings, s;

// Dynamically import Helia and related modules
async function setupHelia() {
  const heliaModule = await import('helia');
  createHelia = heliaModule.createHelia;
  const stringsModule = await import('@helia/strings');
  strings = stringsModule.strings;
  
  const helia = await createHelia(); // Create a Helia node
  s = strings(helia); // Initialize strings with the Helia node
}

// Initialize the Helia setup at the start of your application
setupHelia().then(() => {
  console.log('Helia is set up and ready.');
}).catch(err => {
  console.error('Failed to set up Helia:', err);
});

// Hardcoded address for the bundler
const BUNDLER_ADDRESS = '0xbundler'; // for testing

// Function to publish data to IPFS with signature validation
async function publishToIPFS(data, signature, from) {
  if (from !== BUNDLER_ADDRESS) {
    throw new Error("Unauthorized: Only the bundler can publish new bundles.");
  }

  // Verify the signature
  const signerAddress = ethers.verifyMessage(JSON.stringify(data), signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  // Add the data to Helia and get a CID
  const cid = await s.add(data);
  const timestamp = Date.now(); // Unix timestamp in milliseconds
  console.log("storeCID call", redis, cid, timestamp);
  await redis.zadd('cids', timestamp, cid);
  return cid;
}

async function handleIntention(intention, signature, from) {
  // Verify signature (mock logic)
  const signerAddress = ethers.verifyMessage(intention, signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  // Send intention to the bundler
}

// Function to get the latest CID
async function getLatestBundle() {
  const result = await redis.zrevrange('cids', 0, 0);
  console.log("getLatestBundle call", redis, result);
  if (!result || result.length === 0) throw new Error("No bundles available");
  return { ipfsPath: result[0] };
}

// Function to get CIDs in a specific timestamp range
async function getCIDsByTimestamp(start, end) {
  const result = await redis.zrangebyscore('cids', start, end);
  console.log("getCIDsByTimestamp call", redis, result);
  if (!result || result.length === 0) throw new Error("No data found");
  return result.map(cid => ({ timestamp: start, ipfsPath: cid }));
}

module.exports = { handleIntention, getLatestBundle, publishToIPFS, setRedisClient, getCIDsByTimestamp };
