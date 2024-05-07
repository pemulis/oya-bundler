const ethers = require('ethers');

// Lazy-load redis client
let redis;

// Allow testing environment to inject a mock Redis, or use a real one
function setRedisClient(customClient) {
  redis = customClient;
  console.log("Redis client set:", redis);
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

async function ensureHeliaSetup() {
  if (!s) {
    await setupHelia();
  }
}

// Hardcoded address for the bundler
const BUNDLER_ADDRESS = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf'; // for testing, insecure

// Function to publish data to IPFS with signature validation
async function publishToIPFS(data, signature, from) {
  await ensureHeliaSetup();  // Ensure Helia is ready before proceeding
  console.log("Checking caller's address");
  if (from !== BUNDLER_ADDRESS) {
    throw new Error("Unauthorized: Only the bundler can publish new bundles.");
  }

  console.log("Verifying signature");
  const signerAddress = ethers.verifyMessage(JSON.stringify(data), signature);
  console.log(`Signer Address: ${signerAddress}, Expected: ${from}`);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  console.log("Adding data to IPFS");
  const cid = await s.add(data);  // Ensure this is defined and accessible
  console.log(`Data added, CID: ${cid}`);
  const timestamp = Date.now();
  try {
    const zaddResult = await redis.zadd('cids', timestamp, cid.toString());
    console.log("zaddResult:", zaddResult);
  } catch (error) {
    console.error("Failed to add CID to Redis:", error);
  }
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
