// Load environment variables
require('dotenv').config();

const util = require('util');
const fs = require('fs');
const path = require('path');
const { ethers } = require("ethers");
const { Alchemy, Wallet } = require("alchemy-sdk");
const redis = require('redis');

const settings = {
  apiKey: process.env.ALCHEMY_API_KEY,
  network: "eth-sepolia"
};

const alchemy = new Alchemy(settings);

// Define the contract address and the Sepolia provider
const contractAddress = process.env.BUNDLE_TRACKER_ADDRESS;

// Define the private key of the bundler (for signing the transaction)
const wallet = new Wallet(process.env.TEST_PRIVATE_KEY, alchemy);

// Read the contract ABI from the JSON file
const abiPath = path.join(__dirname, 'abi', 'BundleTracker.json');
const contractABI = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

// Create a contract instance
const bundleTrackerContract = new ethers.Contract(contractAddress, contractABI, wallet);

let brian;

(async () => {
  try {
    const { BrianSDK } = await import('@brian-ai/sdk');

    const options = {
      apiKey: process.env.BRIAN_API_KEY,
      apiUrl: process.env.BRIAN_API_URL,
    };

    brian = new BrianSDK(options);

  } catch (err) {
    console.error('Error importing BrianSDK:', err);
  }
})();

// Lazy-load redis client
let client;

// Allow testing environment to inject a mock Redis, or use a real one
function setRedisClient(customClient) {
  client = customClient;
}

// Initialize Redis client if REDIS_URL is available
if (process.env.REDIS_URL) {
  client = redis.createClient({
    url: process.env.REDIS_URL
  });

  client.on('error', (err) => {
    console.error('Redis Client Error', err);
  });

  client.connect().then(() => {
    setRedisClient(client);
  });
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
  const cidToString = cid.toString();
  const timestamp = Date.now();
  try {
    await client.zadd('cids', timestamp, cidToString);
  } catch (error) {
    console.error("Failed to add CID to Redis:", error);
  }
45
  // Call the proposeBundle function on the contract
  try {
    const tx = await bundleTrackerContract.proposeBundle(cidToString);
    // tx.wait() doesn't work due to differences with alchemy provider functions
    // const receipt = await tx.wait();  // Wait for the transaction to be mined
    const receipt = await alchemy.transact.waitForTransaction(tx.hash);
  } catch (error) {
    console.error("Failed to propose bundle:", error);
    throw new Error("Blockchain transaction failed");
  }
  
  return cid;
}

// Function to get the latest CID
async function getLatestBundle() {
  const result = await client.zrevrange('cids', 0, 0);
  if (!result || result.length === 0) throw new Error("No bundles available");
  return { ipfsPath: result[0] };
}

// Function to get CIDs in a specific timestamp range
async function getCIDsByTimestamp(start, end) {
  // Retrieve both the CIDs and their scores
  const result = await client.zrangebyscore('cids', start, end, 'WITHSCORES');
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
  const signerAddress = ethers.verifyMessage(JSON.stringify(intention), signature);
  if (signerAddress !== from) {
    throw new Error("Signature verification failed");
  }

  // Use Brian to translate intention to transaction details
  txDetails = await brian.transact({
    prompt: intention.action,
    address: from,
  });

  // Future: Alert the bundler with intention and transaction details, and do some checks
  // Future: Store in a cache, to add to a bundle after some time period
  // Future: New function to create a bundle with cached intentions, and then call publish

  // Proof-of-concept: Build a bundle with virtual tx details and publish
  const proof = {
    token: txDetails[0].data.fromToken.address, // null address means ETH
    chainId: txDetails[0].data.fromToken.chainId,
    from: txDetails[0].data.fromAddress, // Oya Safe owned by Bob
    to: txDetails[0].data.toAddress, // Oya Safe owned by Alice, can be virtual
    amount: txDetails[0].data.toAmount, // 1 ETH
    tokenId: 0 // this field is for NFTs, which are not yet supported
  }
  
  const bundle = JSON.stringify(
    {
      proofs: [
        {
          intention: intention,
          // proof below updates balances on the virtual chain, using locked assets
          // proof may require multiple virtual token transfers, but this has just one
          proof: [proof]
        }
      ],
      nonce: 0 // need to save this nonce somewhere
    }
  );

  if (signerAddress === "0x0B42AA7409a9712005dB492945855C176d9C2811") {
    console.log("Intention sent by authorized live tester");
    // Publish the bundle to IPFS
    const bundlerSignature = await wallet.signMessage(bundle);
    publishBundle(bundle, bundlerSignature, from);
  }
  
  return bundle;
}


module.exports = { handleIntention, getLatestBundle, publishBundle, setRedisClient, getCIDsByTimestamp };
