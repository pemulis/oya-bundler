// Load environment variables
require('dotenv').config();

const ethers = require('ethers');

let brian;
(async () => {
  try {
    const { BrianSDK } = await import('@brian-ai/sdk');

    const options = {
      apiKey: process.env.BRIAN_API_KEY,
    };

    brian = new BrianSDK(options);

  } catch (err) {
    console.error('Error importing BrianSDK:', err);
  }
})();

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

async function ensureHeliaSetup() {
  if (!s) {
    await setupHelia();
  }
}

// Hardcoded address for the bundler
const BUNDLER_ADDRESS = '0x42fA5d9E5b0B1c039b08853cF62f8E869e8E5bAf'; // for testing, insecure

// Function to publish data to IPFS with signature validation
async function publishBundle(data, signature, from) {
  await ensureHeliaSetup();  // Ensure Helia is ready before proceeding
  if (from !== BUNDLER_ADDRESS) {
    throw new Error("Unauthorized: Only the bundler can publish new bundles.");
  }

  const signerAddress = ethers.verifyMessage(JSON.stringify(data), signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  const cid = await s.add(data);  // Ensure this is defined and accessible
  const timestamp = Date.now();
  try {
    await redis.zadd('cids', timestamp, cid.toString());
  } catch (error) {
    console.error("Failed to add CID to Redis:", error);
  }
  return cid;
}

// Function to get the latest CID
async function getLatestBundle() {
  const result = await redis.zrevrange('cids', 0, 0);
  if (!result || result.length === 0) throw new Error("No bundles available");
  return { ipfsPath: result[0] };
}

// Function to get CIDs in a specific timestamp range
async function getCIDsByTimestamp(start, end) {
  // Retrieve both the CIDs and their scores
  const result = await redis.zrangebyscore('cids', start, end, 'WITHSCORES');
  if (!result || result.length === 0) throw new Error("No data found");

  // Since the result array includes both the member and the score interleaved,
  // we need to process them in pairs.
  const cidsWithTimestamps = [];
  for (let i = 0; i < result.length; i += 2) {
    const cid = result[i];
    const timestamp = parseInt(result[i + 1], 10);
    cidsWithTimestamps.push({ timestamp, ipfsPath: cid });
  }

  return cidsWithTimestamps;
}

async function handleIntention(intention, signature, from) {
  // Verify signature (mock logic)
  const signerAddress = ethers.verifyMessage(intention, signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  // Use Brian to translate intention to transaction details

  // Alert the bundler with intention and transaction details

  // Store in a cache, to add to a bundle after some time period?

  // New function to create a bundle with cached intentions, and then call publish?
}


module.exports = { handleIntention, getLatestBundle, publishBundle, setRedisClient, getCIDsByTimestamp };
