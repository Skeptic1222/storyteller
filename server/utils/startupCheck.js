/**
 * Startup Health Check
 *
 * Validates all critical modules and dependencies before the server starts.
 * This catches import errors early so NSSM can detect failures and retry.
 *
 * Target: < 5 seconds execution time
 */

import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import { readdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Required environment variables (critical for core functionality)
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY'
];

// Optional but recommended environment variables
const OPTIONAL_ENV_VARS = [
  'VENICE_API_KEY',
  'OPENROUTER_API_KEY',
  'PORT'
];

// Critical modules to validate (relative to server directory)
const CRITICAL_MODULES = [
  // Core services
  '../services/orchestrator.js',
  '../services/elevenlabs.js',
  '../services/openai.js',
  '../services/llmProviders.js',
  '../services/authorStyles.js',
  '../services/modelSelection.js',
  '../services/usageTracker.js',
  '../services/ttsGating.js',

  // Database
  '../database/pool.js',

  // Utils
  './logger.js',
  './promptSecurity.js',
  './apiRetry.js',
  './agentHelpers.js',
  './genderInference.js'
];

/**
 * Check result structure
 */
class CheckResult {
  constructor() {
    this.passed = true;
    this.errors = [];
    this.warnings = [];
    this.details = {
      envVars: { passed: 0, failed: 0, warnings: 0 },
      modules: { passed: 0, failed: 0 },
      agents: { passed: 0, failed: 0 },
      database: { connected: false }
    };
    this.startTime = Date.now();
  }

  addError(category, message) {
    this.passed = false;
    this.errors.push({ category, message, timestamp: new Date().toISOString() });
  }

  addWarning(category, message) {
    this.warnings.push({ category, message, timestamp: new Date().toISOString() });
  }

  getDuration() {
    return Date.now() - this.startTime;
  }

  toSummary() {
    return {
      passed: this.passed,
      duration_ms: this.getDuration(),
      errors: this.errors.length,
      warnings: this.warnings.length,
      details: this.details
    };
  }
}

/**
 * Check required environment variables
 */
function checkEnvironmentVariables(result) {
  console.log('[StartupCheck] Checking environment variables...');

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      result.addError('ENV', `Missing required environment variable: ${varName}`);
      result.details.envVars.failed++;
    } else if (process.env[varName].trim() === '') {
      result.addError('ENV', `Empty required environment variable: ${varName}`);
      result.details.envVars.failed++;
    } else {
      result.details.envVars.passed++;
    }
  }

  for (const varName of OPTIONAL_ENV_VARS) {
    if (!process.env[varName]) {
      result.addWarning('ENV', `Missing optional environment variable: ${varName}`);
      result.details.envVars.warnings++;
    } else {
      result.details.envVars.passed++;
    }
  }
}

/**
 * Attempt to import a module and validate it loaded correctly
 */
async function tryImportModule(modulePath) {
  const fullPath = join(__dirname, modulePath);

  // First check if file exists
  if (!existsSync(fullPath)) {
    throw new Error(`File does not exist: ${fullPath}`);
  }

  // Attempt dynamic import
  const module = await import(modulePath);

  // Basic validation - module should have some exports
  const exportCount = Object.keys(module).length;
  if (exportCount === 0) {
    throw new Error(`Module loaded but has no exports`);
  }

  return { exportCount, exports: Object.keys(module) };
}

/**
 * Check all critical modules can be imported
 */
async function checkCriticalModules(result) {
  console.log('[StartupCheck] Checking critical modules...');

  for (const modulePath of CRITICAL_MODULES) {
    const moduleName = basename(modulePath, '.js');
    try {
      const info = await tryImportModule(modulePath);
      result.details.modules.passed++;
      console.log(`  [OK] ${moduleName} (${info.exportCount} exports)`);
    } catch (error) {
      result.addError('MODULE', `Failed to import ${moduleName}: ${error.message}`);
      result.details.modules.failed++;
      console.log(`  [FAIL] ${moduleName}: ${error.message}`);
    }
  }
}

/**
 * Discover and check all agent files (excluding _archived)
 */
async function checkAgents(result) {
  console.log('[StartupCheck] Checking agent modules...');

  const agentsDir = join(__dirname, '..', 'services', 'agents');

  if (!existsSync(agentsDir)) {
    result.addError('AGENTS', `Agents directory not found: ${agentsDir}`);
    return;
  }

  try {
    const files = readdirSync(agentsDir);
    const agentFiles = files.filter(f =>
      f.endsWith('.js') &&
      !f.startsWith('_') &&  // Skip files starting with underscore
      f !== 'index.js'
    );

    for (const file of agentFiles) {
      const agentName = basename(file, '.js');
      const relativePath = `../services/agents/${file}`;

      try {
        const info = await tryImportModule(relativePath);
        result.details.agents.passed++;
        console.log(`  [OK] ${agentName} (${info.exportCount} exports)`);
      } catch (error) {
        result.addError('AGENT', `Failed to import agent ${agentName}: ${error.message}`);
        result.details.agents.failed++;
        console.log(`  [FAIL] ${agentName}: ${error.message}`);
      }
    }
  } catch (error) {
    result.addError('AGENTS', `Failed to read agents directory: ${error.message}`);
  }
}

/**
 * Test database connection with timeout
 */
async function checkDatabase(result, timeoutMs = 3000) {
  console.log('[StartupCheck] Testing database connection...');

  if (!process.env.DATABASE_URL) {
    result.addError('DATABASE', 'DATABASE_URL not configured');
    return;
  }

  try {
    // Import pool dynamically to catch any import errors
    const { testConnection } = await import('../database/pool.js');

    // Create a timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Connection timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    // Race the connection test against the timeout
    await Promise.race([
      testConnection(),
      timeoutPromise
    ]);

    result.details.database.connected = true;
    console.log('  [OK] Database connection successful');
  } catch (error) {
    result.addError('DATABASE', `Database connection failed: ${error.message}`);
    console.log(`  [FAIL] Database: ${error.message}`);
  }
}

/**
 * Run all startup health checks
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.skipDatabase - Skip database check (for faster checks)
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {CheckResult} - Result object with pass/fail status and details
 */
export async function runStartupChecks(options = {}) {
  const { skipDatabase = false, verbose = false } = options;

  console.log('');
  console.log('=================================================');
  console.log('STORYTELLER STARTUP HEALTH CHECK');
  console.log('=================================================');
  console.log('');

  const result = new CheckResult();

  try {
    // Phase 1: Environment variables (fast)
    checkEnvironmentVariables(result);

    // Phase 2: Critical modules (medium - parallel imports)
    await checkCriticalModules(result);

    // Phase 3: Agent modules (medium - parallel imports)
    await checkAgents(result);

    // Phase 4: Database connection (slow - has timeout)
    if (!skipDatabase) {
      await checkDatabase(result);
    } else {
      console.log('[StartupCheck] Skipping database check (skipDatabase=true)');
    }

  } catch (error) {
    result.addError('SYSTEM', `Unexpected error during startup check: ${error.message}`);
  }

  // Print summary
  console.log('');
  console.log('=================================================');
  console.log('STARTUP CHECK SUMMARY');
  console.log('=================================================');
  console.log(`Duration: ${result.getDuration()}ms`);
  console.log(`Status: ${result.passed ? 'PASSED' : 'FAILED'}`);
  console.log('');
  console.log('Details:');
  console.log(`  Environment: ${result.details.envVars.passed} passed, ${result.details.envVars.failed} failed, ${result.details.envVars.warnings} warnings`);
  console.log(`  Modules: ${result.details.modules.passed} passed, ${result.details.modules.failed} failed`);
  console.log(`  Agents: ${result.details.agents.passed} passed, ${result.details.agents.failed} failed`);
  console.log(`  Database: ${result.details.database.connected ? 'Connected' : 'Not connected'}`);
  console.log('');

  if (result.errors.length > 0) {
    console.log('ERRORS:');
    for (const error of result.errors) {
      console.log(`  [${error.category}] ${error.message}`);
    }
    console.log('');
  }

  if (result.warnings.length > 0 && verbose) {
    console.log('WARNINGS:');
    for (const warning of result.warnings) {
      console.log(`  [${warning.category}] ${warning.message}`);
    }
    console.log('');
  }

  console.log('=================================================');
  console.log('');

  return result;
}

/**
 * Run checks and exit with appropriate code
 * Used when running this file directly: node startupCheck.js
 */
export async function runAndExit() {
  try {
    // Load environment variables
    const dotenv = await import('dotenv');
    dotenv.config({ path: join(__dirname, '..', '..', '.env') });

    const result = await runStartupChecks({ verbose: true });

    if (!result.passed) {
      console.error('Startup checks FAILED - exiting with code 1');
      process.exit(1);
    }

    console.log('Startup checks PASSED');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during startup check:', error);
    process.exit(1);
  }
}

// Allow running directly: node startupCheck.js
// Check if this is the main module being run
const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('startupCheck.js') ||
   process.argv[1].includes('startupCheck'));

if (isMainModule) {
  runAndExit();
}

export default { runStartupChecks, runAndExit };
