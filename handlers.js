const ethers = require('ethers');
const ipfsClient = require('ipfs-http-client');
const Redis = require('ioredis');

const redis = new Redis(); // Default connects to 127.0.0.1:6379
const ipfs = ipfsClient.create({ host: 'ipfs.infura.io', port: 5001, protocol: 'https' });

// Hardcoded address for the bundler
const BUNDLER_ADDRESS = 'YOUR_BUNDLER_ETH_ADDRESS';

// Function to publish data to IPFS with signature validation
async function publishToIPFS(data, signature, from) {
  if (from !== BUNDLER_ADDRESS) {
    throw new Error("Unauthorized: Only the bundler can publish new bundles.");
  }

  // Verify the signature
  const signerAddress = ethers.utils.verifyMessage(JSON.stringify(data), signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  // Add the bundle to IPFS
  const { path } = await ipfs.add(JSON.stringify(data));
  await storeCID(path);
  return path;
}

async function handleIntention(intention, signature, from) {
  // Verify signature (mock logic)
  const signerAddress = ethers.utils.verifyMessage(intention, signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  // Send intention to the bundler
}

// Function to store a new CID with the current timestamp
async function storeCID(cid) {
  const timestamp = Date.now(); // Unix timestamp in milliseconds
  await redis.zadd('cids', timestamp, cid);
}

// Function to get the latest CID
async function getLatestBundle() {
  const result = await redis.zrevrange('cids', 0, 0); // Get the highest scored item
  if (result.length === 0) throw new Error("No bundles available");
  return { ipfsPath: result[0] };
}

// Function to get CIDs in a specific timestamp range
async function getCIDsByTimestamp(start, end) {
  const result = await redis.zrangebyscore('cids', start, end);
  return result.map(cid => ({ timestamp: start, ipfsPath: cid }));
}

module.exports = { handleIntention, getLatestBundle, publishToIPFS };
