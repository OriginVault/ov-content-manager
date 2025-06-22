import { snowflakeToMnemonic, mnemonicToSnowflake, generateSnowflakeId } from '../c2pa-server/src/generateSnowflakeId';
import chalk from 'chalk';

// Test the conversion of Snowflake ID to Mnemonic and back
async function testConversion(id?: string) {
  const snowflakeID = id || generateSnowflakeId();
  console.log(`Generated Snowflake ID: ${snowflakeID}`);

  const mnemonic = snowflakeToMnemonic(snowflakeID);
  console.log(`Converted to Mnemonic: ${mnemonic}`);

  const convertedBackID = mnemonicToSnowflake(mnemonic);
  console.log(`Converted back to Snowflake ID: ${convertedBackID}`);

  if (snowflakeID === convertedBackID) {
    console.log('Test passed: Conversion is consistent.');
  } else {
    console.error('Test failed: Conversion is inconsistent.');
    throw new Error('Conversion is inconsistent.');
  }
  return convertedBackID;
}

// Test the conversion of Mnemonic to Snowflake ID and back
async function testMnemonicConversion() {
  const id = '27826800289787904';
  const mnemonic = 'shield six verb birth barely';
  const snowflakeID = mnemonicToSnowflake(mnemonic);

  if (snowflakeID !== id) {
    console.error('Test failed: Snowflake ID conversion is inconsistent.');
    throw new Error('Snowflake ID conversion is inconsistent.');
  }
  console.log('Test passed: Snowflake ID conversion is consistent.');

  console.log(`Converted Mnemonic to Snowflake ID: ${snowflakeID}`);
  const convertedBackMnemonic = snowflakeToMnemonic(snowflakeID);
  if (mnemonic !== convertedBackMnemonic) {
    console.error('Test failed: Mnemonic conversion is inconsistent.');
    throw new Error('Mnemonic conversion is inconsistent.');
  }
  console.log('Test passed: Mnemonic conversion is consistent.');
}

// Test the different dids create different snowflake ids
async function testDifferentDids() {
  const dids = [
    'did:cheqd:mainnet:80dcaf9a-57b4-5974-a5b0-6d67357d3b2c',
    'did:cheqd:mainnet:280dd37c-aa96-5e71-8548-5125505a968e',
    'did:cheqd:mainnet:38b0251d-34bc-566f-9d2c-15f65b4c55e0',
  ];
  const ids = new Set<string>();
  for (const did of dids) {
    const id = await generateSnowflakeId(did);
    console.log(`Generated Snowflake ID for ${did}: ${id}`);
    await testConversion(id);

    // test uniqueness
    if (ids.has(id)) {
      console.error(`Test failed: Duplicate ID detected on iteration ${dids.indexOf(did) + 1}.`);
      throw new Error('Duplicate ID detected.');
    }
    ids.add(id);
  }
}

// Function to add a delay
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test the generation of multiple Snowflake IDs
async function testMultipleIDGeneration() {
  const ids = new Set<string>();
  const numTests = 5;

  for (let i = 0; i < numTests; i++) {
    const id = await testConversion();

    // Log the generated ID for debugging
    console.log(`Test ${i + 1}: Generated ID: ${id}`);

    // test uniqueness
    if (ids.has(id)) {
      console.error(`Test failed: Duplicate ID detected on iteration ${i + 1}.`);
    }
    ids.add(id);

    // Add a delay to prevent rapid calls
    await delay(100); // 100 milliseconds delay
  }

  if (ids.size === numTests) {
    console.log('Test passed: All generated IDs are unique.');
  } else {
    console.error('Test failed: Duplicate IDs detected.');
    throw new Error('Duplicate IDs detected.');
  }
}

// Run the tests asyncronously
(async () => {
  console.log(chalk.green('Running tests...'));
  await testConversion();
  console.log(chalk.green('Conversion test passed.'));
  await testMnemonicConversion();
  console.log(chalk.green('Mnemonic conversion test passed.'));
  await testMultipleIDGeneration(); 
  console.log(chalk.green('Multiple ID generation test passed.'));
  await testDifferentDids();
  console.log(chalk.green('Different dids test passed.'));
  console.log(chalk.bgGreen('All tests passed.'));
})();