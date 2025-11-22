import FlakeId from 'flake-idgen';
import { wordlist } from '@scure/bip39/wordlists/english';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();
// Access the wordlist directly
const englishWordlist = wordlist;

// Convert Snowflake ID to Mnemonic
export function snowflakeToMnemonic(snowflakeID: string): string {
  const idNum = BigInt(snowflakeID);
  
  // Use a different approach - don't pad to fixed length
  // Just convert to binary and split into chunks
  const binary = idNum.toString(2);
  
  // Ensure the binary length is a multiple of 11 by adding minimal padding
  const paddedBinary = binary.padStart(Math.ceil(binary.length / 11) * 11, '0');
  const chunks = paddedBinary.match(/.{1,11}/g);

  if (!chunks) throw new Error("Failed to split Snowflake ID");

  // Add some entropy to make words more diverse
  const words = chunks.map((chunk, index) => {
    const chunkValue = parseInt(chunk, 2);
    // Add position-based offset to create more variety
    const adjustedIndex = (chunkValue + index * 37) % englishWordlist.length;
    return englishWordlist[adjustedIndex];
  });

  return words.join(' ');
}

// Convert Mnemonic back to Snowflake ID
export function mnemonicToSnowflake(mnemonic: string): string {
  const words = mnemonic.split(' ');
  
  // Reverse the entropy adjustment
  const binary = words
    .map((word, index) => {
      const wordIndex = englishWordlist.indexOf(word);
      if (wordIndex === -1) throw new Error(`Invalid word: ${word}`);
      
      // Reverse the position-based offset
      let originalValue = (wordIndex - index * 37) % englishWordlist.length;
      if (originalValue < 0) originalValue += englishWordlist.length;
      
      return originalValue.toString(2).padStart(11, '0');
    })
    .join('');

  // Remove leading zeros until we get to a valid binary number
  const trimmedBinary = binary.replace(/^0+(?=.)/, '');
  return BigInt('0b' + trimmedBinary).toString();
}

// Function to derive worker ID from DID
function deriveWorkerIdFromDid(did: string): number {
  // Extract a numeric value from the DID
  const didUUID = did.split(':').pop() || '';

  // Create a deterministic hash of the DID UUID
  const didHash = crypto.createHash('sha256').update(didUUID).digest('hex');
  
  // Use a more deterministic approach - take first 12 characters of the hash
  const hashPrefix = didHash.substring(0, 12);
  
  // Convert hex to number using a more direct method
  // This will use the first 12 hex characters (48 bits) which is enough for entropy
  // while staying within safe integer limits
  const workerId = parseInt(hashPrefix, 16) % 4096;
  return workerId;
}

// Get DID from environment variable
const snowflakeDID = process.env.SNOWFLAKE_DID;
if (!snowflakeDID) {
  throw new Error('SNOWFLAKE_DID environment variable is required but not set');
}

// Generate a Snowflake ID
export function generateSnowflakeId(did?: string): string {
  const effectiveDid = did || snowflakeDID;
  if (!effectiveDid) {
    throw new Error('SNOWFLAKE_DID environment variable is required but not set');
  }

  const workerId = parseInt(process.env.SNOWFLAKE_WORKER_ID || String(deriveWorkerIdFromDid(effectiveDid)), 10);
  const datacenterId = parseInt(process.env.SNOWFLAKE_DATACENTER_ID || '1', 10);

  const flakeIdGen = new FlakeId({
    epoch: parseInt(process.env.SNOWFLAKE_EPOCH || '1735689600000', 10),
    datacenter: datacenterId,
    worker: workerId,
  });

  const id = flakeIdGen.next();
  return BigInt('0x' + id.toString('hex')).toString();
}

