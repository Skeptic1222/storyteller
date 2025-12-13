require('dotenv').config();

console.log('Environment check:');
console.log('DEFAULT_VOICE_ID:', process.env.DEFAULT_VOICE_ID);
console.log('Expected George ID: JBFqnCBsd6RMkjVDRZzb');
console.log('Rachel ID (should NOT match): 21m00Tcm4TlvDq8ikWAM');
console.log('Match:', process.env.DEFAULT_VOICE_ID === 'JBFqnCBsd6RMkjVDRZzb' ? 'CORRECT (George)' : 'WRONG!');
