import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from './mcp-native.js';
import { z } from './schema.js';
import { assertGodotProject, normalizeProjectRoot, safeProjectPath } from './fs-safe.js';
import { validateBehavior, validateMake } from './validate.js';
import { applyMake } from './make.js';
import { getGodotMajor, gjmErrorCode, runGodotProject, validateGodotProject } from './godot.js';
import { runBehavior } from './behavior-runner.js';
import { exportMp4, locateFrames, locateCheckpoints } from './record.js';
import { GJM_CODES, errorMessage } from './errors.js';
import { loadJsonInput, importJsonFile, importJsonContent } from './input-json.js';
import { inspectEnvironment } from './environment.js';
import { doctor } from './doctor.js';
import { evaluateAssertions } from './assertions.js';
import { readLastResult, writeRunResult } from './results.js';
import { collectArtifacts, artifactLinks } from './artifacts.js';
import { diagnoseLastResult } from './diagnostics.js';
import { prepareFixContext, applyFix } from './fix.js';
import { startSession, readSession, updateSession, stopSession, nextAttempt } from './session.js';
import { runWorkflow } from './workflow.js';
import { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot } from './snapshots.js';
import { startRuntime, runtimeCommand, stopRuntime, readRuntime } from './runtime.js';
import { workspaceAction, projectAction, gitAction } from './omni.js';
import { listAssets, importAssets } from './assets.js';
import { expandTemplates as expandTemplatesShim } from './templates.js';
import { doAnything } from './ai-anything.js';
import { runGodotScriptTask } from './godot-task.js';
import { sceneOperations } from './scene-ops.js';
import { collectContext } from './context.js';
import { buildProjectIndex } from './project-index.js';
import { runTransaction } from './transaction.js';
import { createReleasePackage, exportMatrix, getReleaseManifest } from './release.js';
import { buildDependencyGraph } from './dependency-graph.js';
import { buildContextPack } from './context-pack.js';
import { generateAnimation, generateModel, generateRig, createShader, importAudio, configureInput, scaffoldNetwork, autoplay, performParallel, startJob, getJob, listJobs, cancelJob, createStudioWorkspace, runStudioPlan } from './game-studio.js';
import { createEditorPlugin, profileProject, networkTest, generateWavTone, generateSvg } from './advanced.js';
import { auditProject, generateTexture, editAnimation, profileCompare, shaderValidate, autoplayFuzz, inputAudit, releaseReadiness } from './power.js';

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}
async function loadJson(root: string, relative: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(safeProjectPath(root, relative), 'utf8')) as unknown;
}

export function createServer() {
  const server = new McpServer(
    { name: 'Godot-J-MCP', version: '7.0.0' },
    {
      instructions:
        'GJM is a Godot development and verification MCP server. Prefer gjm_execute for the full AI workflow: apply godot.make.json, validate Godot, request or apply Behavior.json, run the behavior, evaluate assertions, export MP4, and return artifacts. Use gjm_diagnose and gjm_prepare_fix after failures. All project paths must remain inside projectRoot.'
    }
  );

  server.registerResource(
    'godot-make-schema',
    'gjm://schema/godot.make.json',
    {
      title: 'godot.make.json specification',
      description: 'Declarative GJM project creation and modification format.',
      mimeType: 'application/json'
    },
    async uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          format: 'godot.make',
          version: 1,
          actionTypes: ['directory', 'file', 'script', 'shader', 'resource', 'asset_base64', 'copy', 'project_setting', 'input_action', 'autoload', 'template', 'scene', 'scene_raw', 'feature'],
          purpose: 'AI-authored declarative changes applied by GJM to a Godot project.'
        }, null, 2)
      }]
    })
  );

  server.registerResource(
    'behavior-schema',
    'gjm://schema/Behavior.json',
    {
      title: 'Behavior.json specification',
      description: 'Declarative runtime input and verification format.',
      mimeType: 'application/json'
    },
    async uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          format: 'godot.behavior',
          version: 1,
          actionTypes: ['wait', 'key_down', 'key_up', 'key_press', 'mouse_move', 'mouse_down', 'mouse_up', 'click', 'double_click', 'click_node', 'scroll', 'screenshot', 'inspect_node', 'runtime_command'],
          assertionTypes: ['frames_min', 'checkpoint', 'stdout_contains', 'stderr_not_contains', 'file_exists', 'file_contains']
        }, null, 2)
      }]
    })
  );

  server.registerResource(
    'gjm-result-schema',
    'gjm://schema/result.json',
    {
      title: 'GJM result schema overview',
      description: 'Overview of the machine-readable result phases and status codes.',
      mimeType: 'application/json'
    },
    async uri => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          phases: ['validate', 'behavior-request', 'behavior', 'assert', 'export', 'complete'],
          success: 'GJM-OK',
          nextStep: 'Use gjm_next to continue an active AI repair/test session.'
        }, null, 2)
      }]
    })
  );

  server.registerPrompt(
    'gjm-build-game',
    {
      title: 'Build a Godot game with GJM',
      description: 'Create a godot.make.json plan for an AI-driven Godot build.',
      argsSchema: z.object({ request: z.string() })
    },
    ({ request }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Create a complete godot.make.json for this request. Use only declarative GJM actions and include all required scripts, scenes, nodes, and project settings. Request:\n\n${request}`
        }
      }]
    })
  );

  server.registerPrompt(
    'gjm-test-game',
    {
      title: 'Test a Godot game with GJM',
      description: 'Create a Behavior.json plan for automated Godot runtime testing.',
      argsSchema: z.object({ goal: z.string() })
    },
    ({ goal }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Create a complete Behavior.json for GJM that tests this goal. Include waits, keyboard/mouse input when needed, named screenshots, and useful assertions. Goal:\n\n${goal}`
        }
      }]
    })
  );

  server.registerPrompt(
    'gjm-agent',
    {
      title: 'Work on a Godot project with GJM',
      description: 'Use GJM as the primary Godot automation interface. Inspect the project, make changes, validate, test, diagnose, repair, record, and report evidence.',
      argsSchema: z.object({ request: z.string() })
    },
    ({ request }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Complete this Godot task using GJM tools. Prefer direct tool calls over manual assumptions. Verify every required result and iterate on errors. Task:\n\n${request}`
        }
      }]
    })
  );


  server.registerPrompt(
    'gjm-anything',
    {
      title: 'Do any Godot task',
      description: 'Instruct an AI to use the universal GJM operation tool and verify the result instead of limiting itself to a fixed workflow.',
      argsSchema: z.object({ request: z.string() })
    },
    ({ request }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Complete this Godot task using GJM. You may use gjm_do_anything to combine ordered workspace, project, Godot CLI, make/scene/script patching, runtime, asset, test, snapshot, diagnostic, template, recording, session, modeling, rigging, animation, shaders, audio, networking, jobs, parallel execution, and Git operations. Inspect results after important steps and only report verified outcomes. Task:

${request}`
        }
      }]
    })
  );

  server.registerPrompt(
    'gjm-debug-and-fix',
    {
      title: 'Debug and repair with GJM',
      description: 'Diagnose the current Godot failure, make a targeted repair, revalidate, and continue testing.',
      argsSchema: z.object({ request: z.string() })
    },
    ({ request }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Use GJM to diagnose and repair the current Godot project. Inspect evidence before editing, keep changes scoped, rerun validation, and continue until the requested behavior is proven. Problem/request:\n\n${request}`
        }
      }]
    })
  );

  server.registerResource(
    'gjm-capabilities',
    'gjm://capabilities',
    { title: 'GJM capabilities', description: 'Machine-readable overview of GJM AI-first capabilities.', mimeType: 'application/json' },
    async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({
      version: '7.0.0',
      principle: 'Prompt -> AI -> MCP -> Godot -> verified evidence',
      domains: ['2d','3d','hybrid','ui','physics','animation','audio','navigation','particles','shaders','materials','resources','assets','project','workspace','scene','script','runtime','input','testing','diagnostics','snapshots','git','artifacts','recording','export','feature-presets','modeling','rigging','networking','autoplay','jobs','parallel','editor','profiling','asset-generation','project-audit','texture-generation','animation-editing','shader-validation','input-audit','profile-comparison','fuzz-testing','release-gates'],
      preferredEntryPoint: 'gjm_execute',
      aiFirst: true,
      supportsGodot2D: true,
      supportsGodot3D: true,
      supportsHybrid2D3D: true,
      supportsArbitraryGodotNodes: true,
      supportsRawGodotFiles: true,
      supportsBinaryAssets: true,
      supportsSceneSubresources: true,
      supportsSceneConnections: true,
      supportsProceduralModeling: true,
      supportsRigDefinitions: true,
      supportsShaderGeneration: true,
      supportsAudioUpload: true,
      supportsNetworkingScaffolds: true,
      supportsAutoplay: true,
      supportsLongJobs: true,
      supportsParallelExecution: true
    }, null, 2) }] })
  );

  server.registerTool('gjm_session_start', {
    description: 'Start a GJM repair/test session with a maximum number of AI correction attempts.',
    inputSchema: z.object({ projectRoot: z.string(), maxAttempts: z.number().int().min(1).max(100).default(5) })
  }, async ({ projectRoot, maxAttempts }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const session = await startSession(root, maxAttempts);
      return text({ ok: true, code: GJM_CODES.OK, session });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_session_status', {
    description: 'Read the current GJM session state.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      return text({ ok: true, code: GJM_CODES.OK, session: await readSession(root) });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_next', {
    description: 'Return the next recommended GJM action from the current session/result state for AI orchestration.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const session = await readSession(root);
      const result = await readLastResult(root);
      const resultObject = result !== null && typeof result === 'object' ? result as Record<string, unknown> : undefined;
      if (!session) return text({ ok: false, code: GJM_CODES.ENVIRONMENT, next: { action: 'gjm_session_start', reason: 'No session exists.' } });
      if (session.status === 'completed') return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_read_result', reason: 'Session completed.' }, session, result });
      if (session.status !== 'active') return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_session_start', reason: 'Current session is not active.' }, session, result });
      const code = typeof resultObject?.code === 'string' ? resultObject.code : undefined;
      if (!result) return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_execute', reason: 'Start the first workflow attempt.' }, session });
      if (code === GJM_CODES.BEHAVIOR_REQUIRED) return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_execute', reason: 'Godot validation passed; provide Behavior.json and execute again.', requires: 'Behavior.json' }, session, result });
      if (typeof code === 'string' && code.startsWith('GJM-E2')) return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_diagnose', reason: 'Godot/runtime failure needs AI diagnosis.' }, session, result });
      if (code === GJM_CODES.ASSERTION_FAILED || code === GJM_CODES.BEHAVIOR_RUNTIME) return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_diagnose', reason: 'Behavior/test failure needs diagnosis or a revised Behavior.json.' }, session, result });
      return text({ ok: true, code: GJM_CODES.OK, next: { action: 'gjm_execute', reason: 'Continue the active session.' }, session, result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_session_stop', {
    description: 'Stop the current GJM session.',
    inputSchema: z.object({ projectRoot: z.string(), status: z.enum(['completed', 'failed', 'stopped']).default('stopped') })
  }, async ({ projectRoot, status }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      return text({ ok: true, code: GJM_CODES.OK, session: await stopSession(root, status) });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });


  server.registerTool('gjm_snapshot_create', {
    description: 'Create a rollback snapshot of the Godot project before potentially destructive changes.',
    inputSchema: z.object({ projectRoot: z.string(), label: z.string().max(120).optional() })
  }, async ({ projectRoot, label }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const snapshot = await createSnapshot(root, label);
      return text({ ok: true, code: GJM_CODES.OK, snapshot });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_snapshot_list', {
    description: 'List available GJM rollback snapshots for a Godot project.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      return text({ ok: true, code: GJM_CODES.OK, snapshots: await listSnapshots(root) });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_snapshot_restore', {
    description: 'Restore a Godot project from a previously created GJM snapshot.',
    inputSchema: z.object({ projectRoot: z.string(), snapshotId: z.string().min(1) })
  }, async ({ projectRoot, snapshotId }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const snapshot = await restoreSnapshot(root, snapshotId);
      return text({ ok: true, code: GJM_CODES.OK, restored: snapshot });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_snapshot_delete', {
    description: 'Delete a GJM rollback snapshot.',
    inputSchema: z.object({ projectRoot: z.string(), snapshotId: z.string().min(1) })
  }, async ({ projectRoot, snapshotId }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      return text({ ok: await deleteSnapshot(root, snapshotId), code: GJM_CODES.OK });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_doctor', {
    description: 'Run a GJM diagnostic check for Node.js, Godot, FFmpeg, and the runtime environment.',
    inputSchema: z.object({})
  }, async () => {
    try {
      return text({ ok: true, code: GJM_CODES.OK, doctor: await doctor() });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_environment', {
    description: 'Inspect the GJM runtime environment and tool availability.',
    inputSchema: z.object({})
  }, async () => {
    return text({ ok: true, code: GJM_CODES.OK, environment: await inspectEnvironment() });
  });


  server.registerTool('gjm_runtime_inspect', {
    title: 'Inspect live Godot runtime',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Inspect live Godot runtime' },
    description: 'Read structured telemetry from the currently running GJM Godot runtime, including engine version, current scene, node count, and process state.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await runtimeCommand(root, { op: 'runtime_info' });
      return text({ ok: result.ok === true, code: result.ok === true ? GJM_CODES.OK : GJM_CODES.BEHAVIOR_RUNTIME, runtime: result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.BEHAVIOR_RUNTIME, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_runtime_tree', {
    title: 'Read live Godot scene tree',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Read live Godot scene tree' },
    description: 'Read the current live Godot scene tree without changing runtime state.',
    inputSchema: z.object({ projectRoot: z.string(), path: z.string().default('.') })
  }, async ({ projectRoot, path: nodePath }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await runtimeCommand(root, { op: 'tree', path: nodePath });
      return text({ ok: result.ok === true, code: result.ok === true ? GJM_CODES.OK : GJM_CODES.BEHAVIOR_RUNTIME, runtime: result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.BEHAVIOR_RUNTIME, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_context_pack', {
    title: 'Build AI context pack',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Build AI context pack' },
    description: 'Build a compact machine-readable context bundle containing project context, project index, dependency graph, recent result/session state, and selected text files for AI reasoning.',
    inputSchema: z.object({
      projectRoot: z.string(),
      maxFiles: z.number().optional(),
      maxFileBytes: z.number().optional(),
      includeContent: z.boolean().default(true)
    })
  }, async ({ projectRoot, maxFiles, maxFileBytes, includeContent }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const pack = await buildContextPack(root, { maxFiles, maxFileBytes, includeContent });
      return text({ ok: true, code: GJM_CODES.OK, pack });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_server_info', {
    title: 'GJM server information',
    description: 'Return GJM protocol-facing server metadata, capabilities, supported formats, and workflow entry points.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'GJM server information' },
    inputSchema: z.object({})
  }, async () => {
    return text({
      ok: true,
      code: GJM_CODES.OK,
      server: { name: 'Godot-J-MCP', version: '7.0.0', protocol: 'MCP', transport: 'stdio' },
      workflows: ['gjm_execute', 'gjm_pipeline'],
      formats: ['godot.make.json', 'Behavior.json', '.gjm_last_result.json'],
      features: ['sessions', 'snapshots', 'AI-diagnosis', 'AI-repair', 'assertions', 'artifacts', 'MP4-export', 'uploaded-JSON-import', 'live-runtime-bridge', 'runtime-telemetry', 'AI-first-prompts', 'workspace-operations', 'project-operations', 'git-operations']
    });
  });

  server.registerTool('gjm_import_json', {
    title: 'Import GJM JSON',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Import GJM JSON' },
    description: 'Import an AI-uploaded godot.make.json or Behavior.json into the target Godot project. Use sourceFile for a local uploaded file or content for inline JSON.',
    inputSchema: z.object({
      projectRoot: z.string(),
      kind: z.enum(['make', 'behavior']),
      sourceFile: z.string().optional(),
      content: z.string().optional(),
      destination: z.string().optional()
    })
  }, async ({ projectRoot, kind, sourceFile, content, destination }) => {
    try {
      if ((sourceFile === undefined) === (content === undefined)) {
        throw new Error('Provide exactly one of sourceFile or content.');
      }
      const root = normalizeProjectRoot(projectRoot);
      const imported = sourceFile !== undefined
        ? await importJsonFile(root, sourceFile, kind, destination)
        : await importJsonContent(root, content!, kind, destination);
      if (kind === 'make') {
        const make = validateMake(await loadJson(root, imported.destination));
        return text({ ok: true, code: GJM_CODES.OK, imported, validation: { kind, version: make.version, actions: make.actions.length } });
      }
      const behavior = validateBehavior(await loadJson(root, imported.destination));
      return text({ ok: true, code: GJM_CODES.OK, imported, validation: { kind, actions: behavior.actions.length } });
    } catch (error) {
      const code = kind === 'behavior' ? GJM_CODES.BEHAVIOR_INVALID : GJM_CODES.MAKE_INVALID;
      return text({ ok: false, code, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_make_validate', {
    description: 'Validate godot.make.json without modifying the project. Accepts a file path or inline JSON content.',
    inputSchema: z.object({ projectRoot: z.string(), file: z.string().optional(), content: z.string().optional() })
  }, async ({ projectRoot, file, content }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const make = validateMake(await loadJsonInput(root, file ?? 'godot.make.json', content, 'godot.make.json'));
      return text({ ok: true, code: GJM_CODES.OK, version: make.version, actions: make.actions.length, message: 'godot.make.json is valid.' });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.MAKE_INVALID, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_make_apply', {
    description: 'Read and apply godot.make.json to a Godot project. Accepts a file path or inline JSON content.',
    inputSchema: z.object({ projectRoot: z.string(), file: z.string().optional(), content: z.string().optional(), dryRun: z.boolean().default(false) })
  }, async ({ projectRoot, file, content, dryRun }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const make = validateMake(await loadJsonInput(root, file ?? 'godot.make.json', content, 'godot.make.json'));
      const major = dryRun ? 4 : await getGodotMajor();
      const changes = await applyMake(root, make, dryRun, major);
      return text({ ok: true, code: GJM_CODES.OK, dryRun, changes, message: dryRun ? 'Dry run completed.' : 'godot.make.json applied.' });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.MAKE_APPLY_FAILED, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_validate', {
    description: 'Validate the Godot project in headless mode and return a structured GJM error.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      await assertGodotProject(root);
      const result = await validateGodotProject(root);
      return text({ ok: result.code === 0, code: gjmErrorCode(result), exitCode: result.code, stdout: result.stdout, stderr: result.stderr }, result.code !== 0);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_run', {
    description: 'Run a Godot project or a specific scene.',
    inputSchema: z.object({ projectRoot: z.string(), scene: z.string().optional(), timeoutMs: z.number().int().min(1000).max(600000).default(30000) })
  }, async ({ projectRoot, scene, timeoutMs }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      await assertGodotProject(root);
      const result = await runGodotProject(root, scene, timeoutMs);
      return text({ ok: result.code === 0, code: gjmErrorCode(result), exitCode: result.code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut === true }, result.code !== 0);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_behavior_validate', {
    description: 'Validate Behavior.json before runtime execution. Accepts a file path or inline JSON content.',
    inputSchema: z.object({ projectRoot: z.string(), file: z.string().optional(), content: z.string().optional() })
  }, async ({ projectRoot, file, content }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const behavior = validateBehavior(await loadJsonInput(root, file ?? 'Behavior.json', content, 'Behavior.json'));
      return text({ ok: true, code: GJM_CODES.OK, actions: behavior.actions.length, message: 'Behavior.json is valid.' });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.BEHAVIOR_INVALID, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_run_behavior', {
    description: 'Run Behavior.json in the GJM runner and capture PNG frames.',
    inputSchema: z.object({ projectRoot: z.string(), file: z.string().default('Behavior.json') })
  }, async ({ projectRoot, file }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const behavior = validateBehavior(await loadJson(root, file));
      const result = await runBehavior(root, behavior);
      const frames = await locateFrames(root);
      const checkpoints = await locateCheckpoints(root);
      const assertions = await evaluateAssertions(root, behavior, result, frames, checkpoints);
      const ok = result.code === 0 && assertions.ok;
      const code = result.code !== 0 ? GJM_CODES.BEHAVIOR_RUNTIME : (assertions.ok ? GJM_CODES.OK : GJM_CODES.ASSERTION_FAILED);
      return text({ ok, code, exitCode: result.code, frameCount: frames.length, checkpointCount: checkpoints.length, checkpoints, assertions: assertions.results, stdout: result.stdout, stderr: result.stderr }, !ok);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.BEHAVIOR_APPLY_FAILED, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_export_mp4', {
    description: 'Convert captured GJM PNG frames into an H.264 MP4 with FFmpeg.',
    inputSchema: z.object({ projectRoot: z.string(), output: z.string().default('gjm-result.mp4'), fps: z.number().int().min(1).max(120).default(30) })
  }, async ({ projectRoot, output, fps }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await exportMp4(root, output, fps);
      return text({ ...result, code: result.ok ? GJM_CODES.OK : GJM_CODES.FFMPEG_FAILED }, !result.ok);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.FFMPEG_FAILED, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_pipeline', {
    title: 'Run GJM pipeline',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Run GJM pipeline' },
    description: 'Execute GJM end-to-end. Make and Behavior can be supplied by file path or inline JSON.',
    inputSchema: z.object({
      projectRoot: z.string(),
      makeFile: z.string().optional(),
      makeContent: z.string().optional(),
      behaviorFile: z.string().optional(),
      behaviorContent: z.string().optional(),
      mp4: z.string().optional(),
      sessionId: z.string().optional(),
      snapshot: z.boolean().default(true)
    })
  }, async ({ projectRoot, makeFile, makeContent, behaviorFile, behaviorContent, mp4, sessionId, snapshot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const existingSession = await readSession(root);
      if (sessionId && (!existingSession || existingSession.id !== sessionId)) {
        return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: 'Unknown or expired sessionId.' }, true);
      }
      if (existingSession?.status !== 'active') {
        return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: 'GJM session is not active.', session: existingSession }, true);
      }
      const session = existingSession ? await nextAttempt(root) : undefined;
      const make = validateMake(await loadJsonInput(root, makeFile ?? 'godot.make.json', makeContent, 'godot.make.json'));
      const major = await getGodotMajor();
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const snapshotInfo = snapshot !== false ? await createSnapshot(root, `pipeline-${session?.attempt ?? 'initial'}`) : undefined;
      const changes = await applyMake(root, make, false, major);
      const validation = await validateGodotProject(root);
      if (validation.code !== 0) {
        const result = { ok: false, phase: 'validate', code: gjmErrorCode(validation), session, snapshot: snapshotInfo, changes, exitCode: validation.code, stdout: validation.stdout, stderr: validation.stderr, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs };
        await writeRunResult(root, result);
        if (session) await updateSession(root, { status: 'failed', phase: result.phase, lastCode: result.code });
        return text(result, true);
      }

      let behavior;
      try {
        behavior = validateBehavior(await loadJsonInput(root, behaviorFile ?? 'Behavior.json', behaviorContent, 'Behavior.json'));
      } catch {
        const result = { ok: false, phase: 'behavior-request', session, code: GJM_CODES.BEHAVIOR_REQUIRED, snapshot: snapshotInfo, changes, message: 'Godot project is valid. AI must provide Behavior.json before runtime execution.', next: { tool: 'gjm_pipeline', requiredFile: behaviorFile }, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs };
        await writeRunResult(root, result);
        return text(result);
      }

      const run = await runBehavior(root, behavior);
      const fps = behavior.capture?.fps ?? 30;
      const frames = await locateFrames(root);
      const checkpoints = await locateCheckpoints(root);
      const assertions = await evaluateAssertions(root, behavior, run, frames, checkpoints);
      if (run.code !== 0) {
        const result = { ok: false, phase: 'behavior', session, code: GJM_CODES.BEHAVIOR_RUNTIME, snapshot: snapshotInfo, changes, exitCode: run.code, stdout: run.stdout, stderr: run.stderr, assertions: assertions.results, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs };
        await writeRunResult(root, result);
        if (session) await updateSession(root, { status: 'failed', phase: result.phase, lastCode: result.code });
        return text(result, true);
      }
      if (!assertions.ok) {
        const result = { ok: false, phase: 'assert', session, code: GJM_CODES.ASSERTION_FAILED, snapshot: snapshotInfo, changes, exitCode: run.code, frames: frames.length, checkpoints: checkpoints.map(p => path.relative(root, p)), behaviorActions: behavior.actions.length, assertions: assertions.results, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs };
        await writeRunResult(root, result);
        if (session) await updateSession(root, { status: 'failed', phase: result.phase, lastCode: result.code });
        return text(result, true);
      }
      const output = mp4 ?? behavior.capture?.outputName ?? 'gjm-result.mp4';
      const video = await exportMp4(root, output, fps);
      const result = {
        ok: video.ok,
        session,
        snapshot: snapshotInfo,
        phase: video.ok ? 'complete' : 'export',
        code: video.ok ? GJM_CODES.OK : GJM_CODES.FFMPEG_FAILED,
        changes,
        frames: frames.length,
        checkpoints: checkpoints.map(p => path.relative(root, p)),
        behaviorActions: behavior.actions.length,
        assertions: assertions.results,
        video,
        artifacts: await collectArtifacts(root),
        artifactLinks: artifactLinks(root, await collectArtifacts(root)),
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedMs
      };
      await writeRunResult(root, result);
      if (session) await updateSession(root, { status: video.ok ? 'completed' : 'failed', phase: result.phase, lastCode: result.code });
      return text(result, !video.ok);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error), cwd: path.resolve(process.cwd()) }, true);
    }
  });


  server.registerTool('gjm_execute', {
    title: 'Execute GJM workflow',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Execute GJM workflow' },
    description: 'Run the complete GJM workflow. Starts a session automatically when needed, applies make JSON, validates Godot, waits for Behavior JSON, runs it, evaluates assertions, exports MP4, and returns artifacts.',
    inputSchema: z.object({
      projectRoot: z.string(),
      makeFile: z.string().optional(),
      makeContent: z.string().optional(),
      behaviorFile: z.string().optional(),
      behaviorContent: z.string().optional(),
      mp4: z.string().optional(),
      maxAttempts: z.number().int().min(1).max(100).default(5),
      sessionId: z.string().optional(),
      snapshot: z.boolean().default(true)
    })
  }, async (args) => {
    try {
      return text(await runWorkflow(args));
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_runtime_start', {
    title: 'Start live Godot runtime',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: 'Start live Godot runtime' },
    description: 'Start a live localhost-only GJM runtime bridge for the project. Returns a runtime id and port.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      await assertGodotProject(root);
      return text({ ok: true, code: GJM_CODES.OK, runtime: await startRuntime(root) });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.GODOT_RUNTIME, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_runtime_status', {
    title: 'Get live runtime status',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get live runtime status' },
    description: 'Return the current live GJM runtime bridge state for a project.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      return text({ ok: true, code: GJM_CODES.OK, runtime: await readRuntime(root) });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_runtime_command', {
    title: 'Control live Godot runtime',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Control live Godot runtime' },
    description: 'Send a localhost runtime command to a running Godot bridge. Supported operations: ping, runtime_info, tree, inspect_node, get_property, set_property, call_method, screenshot, quit.',
    inputSchema: z.object({
      projectRoot: z.string(),
      runtimeId: z.string().min(1).optional(),
      op: z.enum(['ping','runtime_info','tree','inspect_node','get_property','set_property','call_method','screenshot','quit']),
      path: z.string().optional(),
      property: z.string().optional(),
      value: z.unknown().optional(),
      method: z.string().optional(),
      args: z.array(z.unknown()).optional(),
      output: z.string().optional()
    })
  }, async ({ projectRoot, runtimeId, op, path: nodePath, property, value, method, args, output }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const request: Record<string, unknown> = { op };
      const runtimeState = await readRuntime(root);
      if (!runtimeState) throw new Error('No active GJM runtime.');
      if (runtimeId !== undefined && runtimeId !== runtimeState.id) throw new Error('Unknown runtimeId.');
      if (nodePath !== undefined) request.path = nodePath;
      if (property !== undefined) request.property = property;
      if (value !== undefined) request.value = value;
      if (method !== undefined) request.method = method;
      if (args !== undefined) request.args = args;
      if (output !== undefined) {
        const safe = safeProjectPath(root, output);
        request.path = 'res://' + path.relative(root, safe).split(path.sep).join('/');
      }
      const result = await runtimeCommand(root, request);
      return text({ ok: result.ok !== false, code: result.ok === false ? GJM_CODES.GODOT_RUNTIME : GJM_CODES.OK, runtime: result }, result.ok === false);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.GODOT_RUNTIME, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_runtime_stop', {
    title: 'Stop live Godot runtime',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Stop live Godot runtime' },
    description: 'Stop the live GJM runtime bridge for a project.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      await stopRuntime(root);
      return text({ ok: true, code: GJM_CODES.OK });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.GODOT_RUNTIME, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_artifacts', {
    title: 'List GJM artifacts',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List GJM artifacts' },
    description: 'List GJM test artifacts such as the latest result, MP4, PNG frames, and named checkpoints.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const artifacts = await collectArtifacts(root);
      return text({ ok: true, code: GJM_CODES.OK, artifacts, links: artifactLinks(root, artifacts) });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_diagnose', {
    title: 'Diagnose latest failure',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Diagnose latest failure' },
    description: 'Build a compact AI-oriented diagnostic context from the latest GJM result, including error output and relevant source snippets.',
    inputSchema: z.object({
      projectRoot: z.string(),
      maxSnippetLines: z.number().int().min(1).max(80).default(12)
    })
  }, async ({ projectRoot, maxSnippetLines }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const diagnosis = await diagnoseLastResult(root, maxSnippetLines);
      return text({ ok: true, code: GJM_CODES.OK, diagnosis });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_prepare_fix', {
    description: 'Prepare an AI repair context from the latest GJM failure, including the current make file and source diagnostics.',
    inputSchema: z.object({
      projectRoot: z.string(),
      maxSnippetLines: z.number().int().min(1).max(80).default(16)
    })
  }, async ({ projectRoot, maxSnippetLines }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      return text(await prepareFixContext(root, maxSnippetLines));
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_apply_fix', {
    description: 'Apply a complete corrected godot.make.json supplied by AI and immediately re-run Godot validation.',
    inputSchema: z.object({
      projectRoot: z.string(),
      makeContent: z.string().min(1)
    })
  }, async ({ projectRoot, makeContent }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await applyFix(root, makeContent);
      return text(result, !result.ok);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.MAKE_INVALID, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_read_result', {
    title: 'Read GJM result',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Read GJM result' },
    description: 'Read the most recent GJM pipeline result from the project.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await readLastResult(root);
      return text({ ok: true, code: GJM_CODES.OK, result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });


  server.registerTool('gjm_workspace', {
    title: 'Manage Godot project workspace',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Manage Godot project workspace' },
    description: 'Perform safe workspace operations inside projectRoot: list, read, write, mkdir, delete, copy, move, or text search. Paths cannot escape the project root.',
    inputSchema: z.object({
      projectRoot: z.string(),
      op: z.enum(['list','read','write','mkdir','delete','copy','move','search']),
      path: z.string().optional(),
      content: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      recursive: z.boolean().default(false),
      query: z.string().optional(),
      maxResults: z.number().int().min(1).max(1000).default(100)
    })
  }, async ({ projectRoot, op, path: targetPath, content, from, to, recursive, query, maxResults }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await workspaceAction(root, op, { path: targetPath, content, from, to, recursive, query, maxResults });
      return text({ ok: true, code: GJM_CODES.OK, op, result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_project', {
    title: 'Operate a Godot project',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Operate a Godot project' },
    description: 'High-level project operations: inspect project info/settings, run the project, or export it with a Godot preset.',
    inputSchema: z.object({
      projectRoot: z.string(),
      op: z.enum(['info','settings','run','export']),
      preset: z.string().optional(),
      output: z.string().optional(),
      mode: z.enum(['debug','release']).default('release'),
      timeoutMs: z.number().int().min(1000).max(1200000).default(30000)
    })
  }, async ({ projectRoot, op, preset, output, mode, timeoutMs }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      if (op === 'export' && (!preset || !output)) throw new Error('export requires preset and output.');
      const result = await projectAction(root, op, { preset, output, mode, timeoutMs });
      return text({ ok: true, code: GJM_CODES.OK, op, result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_git', {
    title: 'Use Git for the Godot project',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Use Git for the Godot project' },
    description: 'Run a restricted Git operation inside projectRoot. Supported: status, diff, log, branch, rev-parse, add, commit, restore, checkout.',
    inputSchema: z.object({ projectRoot: z.string(), args: z.array(z.string()).min(1).max(20) })
  }, async ({ projectRoot, args }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const result = await gitAction(root, args);
      return text({ ok: true, code: GJM_CODES.OK, result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_assets', {
    title: 'Manage Godot assets',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Manage Godot assets' },
    description: 'List imported project assets and ask Godot to scan/reimport project assets. Supports common 2D/3D/audio/font/shader asset classes.',
    inputSchema: z.object({ projectRoot: z.string(), op: z.enum(['list','import']), timeoutMs: z.number().int().min(1000).max(600000).default(120000) })
  }, async ({ projectRoot, op, timeoutMs }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      if (op === 'list') return text({ ok: true, code: GJM_CODES.OK, assets: await listAssets(root) });
      const result = await importAssets(root, timeoutMs);
      return text({ ok: result.code === 0, code: result.code === 0 ? GJM_CODES.OK : gjmErrorCode(result), result });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_template_apply', {
    title: 'Apply a GJM game template',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Apply a GJM game template' },
    description: 'Generate and apply a high-level GJM template to the current Godot project, then validate it.',
    inputSchema: z.object({ projectRoot: z.string(), name: z.string(), snapshot: z.boolean().default(true) })
  }, async ({ projectRoot, name, snapshot }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const major = await getGodotMajor();
      const actions = expandTemplatesShim([name], major);
      const make = { format: 'godot.make', version: 1, name: name, actions };
      const validated = validateMake(make);
      const snap = snapshot ? await createSnapshot(root, `template-${name}`) : undefined;
      const changes = await applyMake(root, validated, false, major);
      const validation = await validateGodotProject(root);
      return text({ ok: validation.code === 0, code: validation.code === 0 ? GJM_CODES.OK : GJM_CODES.GODOT_RUNTIME, template: name, snapshot: snap, changes, validation });
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_template_list', {
    title: 'List GJM game templates',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List GJM game templates' },
    description: 'List high-level game and system templates supported by GJM.',
    inputSchema: z.object({})
  }, async () => text({ ok: true, code: GJM_CODES.OK, templates: ['platformer_2d','topdown_2d','third_person_3d','first_person_3d','ui_menu','save_system','audio_manager'] }));


  server.registerTool('gjm_scene_operations', {
    title: 'Apply Godot scene operations',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Apply Godot scene operations' },
    description: 'Perform structured Godot scene edits using the engine itself: create scenes, add/remove/rename/reparent nodes, set properties, attach scripts, and duplicate nodes.',
    inputSchema: z.object({
      projectRoot: z.string(),
      operations: z.array(z.object({
        op: z.enum(['create','add_node','remove_node','rename_node','reparent_node','set_property','attach_script','duplicate_node','save']),
        scene: z.string(),
        parent: z.string().optional(),
        type: z.string().optional(),
        name: z.string().optional(),
        path: z.string().optional(),
        property: z.string().optional(),
        value: z.unknown().optional(),
        script: z.string().optional(),
        properties: z.unknown().optional()
      })),
      timeoutMs: z.number().int().min(1000).max(600000).default(120000)
    })
  }, async ({ projectRoot, operations, timeoutMs }) => {
    try {
      const result = await sceneOperations(projectRoot, operations as any, timeoutMs);
      return text(result, !result.ok);
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_godot_script', {
    title: 'Run a custom Godot script task',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Run a custom Godot script task' },
    description: 'Run a project-local GDScript task under Godot CLI. This is the escape hatch for Godot APIs not covered by higher-level GJM operations.',
    inputSchema: z.object({
      projectRoot: z.string(),
      script: z.string(),
      args: z.array(z.string()).optional(),
      timeoutMs: z.number().optional(),
      resultFile: z.string().optional()
    })
  }, async ({ projectRoot, script, args, timeoutMs, resultFile }) => {
    try { return text(await runGodotScriptTask({ projectRoot, script, args, timeoutMs, resultFile })); }
    catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });

  server.registerTool('gjm_plan', {
    title: 'Validate GJM execution plan',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Validate GJM execution plan' },
    description: 'Validate a multi-step GJM plan before execution. Checks supported operations and duplicate step IDs without changing the project.',
    inputSchema: z.object({ steps: z.array(z.object({ op: z.string(), args: z.unknown().optional(), id: z.string().optional(), continueOnError: z.boolean().optional(), retries: z.number().int().min(0).max(10).optional(), when: z.unknown().optional() })) })
  }, async ({ steps }) => {
    try {
      const { validatePlan } = await import('./ai-anything.js');
      return text(validatePlan(steps as any));
    } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_do_anything', {
    title: 'Do anything in Godot',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Do anything in Godot' },
    description: 'Execute a bounded multi-step GJM plan. The AI supplies ordered operations for project files, make/scene/script work, Godot CLI, runtime control, tests, snapshots, diagnostics, assets, recording, templates, sessions, and Git.',
    inputSchema: z.object({
      projectRoot: z.string(),
      steps: z.array(z.object({ op: z.string(), args: z.unknown().optional(), id: z.string().optional(), continueOnError: z.boolean().optional() })),
      snapshot: z.boolean().default(true),
      stopOnError: z.boolean().default(true),
      rollbackOnError: z.boolean().default(false)
    })
  }, async ({ projectRoot, steps, snapshot, stopOnError, rollbackOnError }) => {
    try { return text(await doAnything({ projectRoot, steps: steps as any, snapshot, stopOnError, rollbackOnError })); }
    catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });

  server.registerTool('gjm_universal', {
    title: 'Universal Godot automation',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Universal Godot automation' },
    description: 'Universal AI-first Godot automation. Build, edit, debug, test, run, inspect, control runtime, manage assets, record/export, patch source/scenes, use templates, snapshots, sessions, workspace and git in one MCP call.',
    inputSchema: z.object({
      projectRoot: z.string(),
      operation: z.string(),
      payload: z.unknown().optional()
    })
  }, async ({ projectRoot, operation, payload }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      const p = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
      switch (operation) {
        case 'workspace': return text({ ok: true, code: GJM_CODES.OK, result: await workspaceAction(root, String(p.op ?? 'list'), p) });
        case 'project': return text({ ok: true, code: GJM_CODES.OK, result: await projectAction(root, String(p.op ?? 'info'), p) });
        case 'git': return text({ ok: true, code: GJM_CODES.OK, result: await gitAction(root, Array.isArray(p.args) ? p.args.map(String) : ['status']) });
        case 'make_validate': return text({ ok: true, code: GJM_CODES.OK, result: validateMake(await loadJsonInput(root, String(p.file ?? 'godot.make.json'), typeof p.content === 'string' ? p.content : undefined, 'godot.make.json')) });
        case 'behavior_validate': return text({ ok: true, code: GJM_CODES.OK, result: validateBehavior(await loadJsonInput(root, String(p.file ?? 'Behavior.json'), typeof p.content === 'string' ? p.content : undefined, 'Behavior.json')) });
        case 'execute': return text(await runWorkflow({ projectRoot: root, makeFile: typeof p.makeFile === 'string' ? p.makeFile : undefined, makeContent: typeof p.makeContent === 'string' ? p.makeContent : undefined, behaviorFile: typeof p.behaviorFile === 'string' ? p.behaviorFile : undefined, behaviorContent: typeof p.behaviorContent === 'string' ? p.behaviorContent : undefined, maxAttempts: Number(p.maxAttempts ?? 5), snapshot: p.snapshot !== false }));
        case 'runtime': return text(await runtimeCommand(root, p));
        case 'artifacts': return text({ ok: true, code: GJM_CODES.OK, artifacts: await collectArtifacts(root) });
        case 'assets': return text({ ok: true, code: GJM_CODES.OK, assets: await listAssets(root) });
        case 'assets_import': { const r = await importAssets(root, Number(p.timeoutMs ?? 120000)); return text({ ok: r.code === 0, code: r.code === 0 ? GJM_CODES.OK : gjmErrorCode(r), result: r }); }
        case 'template': { const name = String(p.name ?? ''); const major = await getGodotMajor(); const actions = expandTemplatesShim([name], major); const make = { format: 'godot.make', version: 1, actions }; return text({ ok: true, code: GJM_CODES.OK, template: name, make }); }
        case 'diagnose': return text({ ok: true, code: GJM_CODES.OK, diagnosis: await diagnoseLastResult(root, Number(p.maxSnippetLines ?? 16)) });
        default: return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: `Unknown universal operation: ${operation}` }, true);
      }
    } catch (error) {
      return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true);
    }
  });

  server.registerTool('gjm_context', {
    title: 'Collect AI project context',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Collect AI project context' },
    description: 'Collect a bounded machine-readable snapshot of project, Godot environment, session, runtime, last result, snapshots, artifacts, and workspace metadata in one call.',
    inputSchema: z.object({ projectRoot: z.string(), includeFiles: z.boolean().default(true), includeContent: z.boolean().default(false), maxFiles: z.number().int().min(1).max(5000).default(300) })
  }, async ({ projectRoot, includeFiles, includeContent, maxFiles }) => {
    try { return text(await collectContext(projectRoot, { includeFiles, includeContent, maxFiles })); }
    catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });


  server.registerTool('gjm_project_index', {
    title: 'Index Godot project',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Index Godot project' },
    description: 'Build a bounded structural index of scenes, scripts, shaders, resources, nodes, classes, and functions for AI project understanding.',
    inputSchema: z.object({ projectRoot: z.string(), maxFiles: z.number().int().min(1).max(10000).default(2000), includeSource: z.boolean().default(false), maxSourceBytes: z.number().int().min(1024).max(2000000).default(200000) })
  }, async ({ projectRoot, maxFiles, includeSource, maxSourceBytes }) => {
    try { return text(await buildProjectIndex(projectRoot, { maxFiles, includeSource, maxSourceBytes })); }
    catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });

  server.registerTool('gjm_transaction', {
    title: 'Run atomic GJM transaction',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Run atomic GJM transaction' },
    description: 'Run a bounded multi-step GJM operation atomically. A pre-change snapshot is created and automatically restored if any step fails.',
    inputSchema: z.object({ projectRoot: z.string(), steps: z.array(z.object({ op: z.string(), args: z.unknown().optional(), id: z.string().optional(), continueOnError: z.boolean().optional() })), keepSnapshot: z.boolean().default(false) })
  }, async ({ projectRoot, steps, keepSnapshot }) => {
    try { return text(await runTransaction({ projectRoot, steps: steps as any, keepSnapshot })); }
    catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });

  server.registerTool('gjm_editor_plugin', {
    title: 'Generate a Godot editor plugin',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Generate a Godot editor plugin' },
    description: 'Create a version-aware Godot @tool/EditorPlugin that adds an editor toolbar action.',
    inputSchema: z.object({ projectRoot: z.string(), name: z.string().optional(), outputDir: z.string().optional(), buttonText: z.string().optional(), godotBin: z.string().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await createEditorPlugin(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_profile', {
    title: 'Profile a Godot project',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Profile a Godot project' },
    description: 'Run a bounded Godot profiling session and return measured FPS, frames, node count and processing-node count.',
    inputSchema: z.object({ projectRoot: z.string(), seconds: z.number().min(1).max(300).default(10), output: z.string().optional(), godotBin: z.string().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await profileProject(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_network_test', {
    title: 'Test Godot networking',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Test Godot networking' },
    description: 'Start a loopback ENet or WebSocket server inside Godot briefly and verify it can bind and initialize.',
    inputSchema: z.object({ projectRoot: z.string(), mode: z.enum(['enet','websocket']).default('enet'), port: z.number().int().min(1024).max(65535).default(47839), timeoutMs: z.number().int().min(1000).max(120000).default(30000), godotBin: z.string().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await networkTest(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_generate_wav', {
    title: 'Generate a WAV asset',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Generate a WAV asset' },
    description: 'Generate a procedural PCM WAV tone directly without external audio software.',
    inputSchema: z.object({ projectRoot: z.string(), output: z.string().optional(), seconds: z.number().min(0.05).max(60).default(1), frequency: z.number().min(1).max(20000).default(440), sampleRate: z.number().int().min(8000).max(192000).default(44100), amplitude: z.number().min(0).max(1).default(0.2) })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await generateWavTone(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_generate_svg', {
    title: 'Generate a vector asset',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Generate a vector asset' },
    description: 'Generate a procedural SVG asset directly from GJM.',
    inputSchema: z.object({ projectRoot: z.string(), output: z.string().optional(), width: z.number().min(1).max(8192).default(512), height: z.number().min(1).max(8192).default(512), background: z.string().optional(), foreground: z.string().optional(), text: z.string().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await generateSvg(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_animation', {
    title: 'Create or edit an animation clip',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Create or edit an animation clip' },
    description: 'Create a reusable GJM animation clip manifest and runtime GDScript player with keyframes.',
    inputSchema: z.object({ projectRoot: z.string(), name: z.string().optional(), output: z.string().optional(), runtimeScript: z.string().optional(), target: z.string().optional(), property: z.string().optional(), tracks: z.array(z.unknown()).optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await generateAnimation(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_model', {
    title: 'Generate a procedural 3D model',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Generate a procedural 3D model' },
    description: 'Generate a small procedural OBJ model directly with GJM.',
    inputSchema: z.object({ projectRoot: z.string(), kind: z.enum(['cube','plane','pyramid','cylinder','uv_sphere']).default('cube'), output: z.string().optional(), name: z.string().optional(), size: z.number().optional(), width: z.number().optional(), height: z.number().optional(), depth: z.number().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await generateModel(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_rig', {
    title: 'Generate a rig definition',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Generate a rig definition' },
    description: 'Create a reusable bone hierarchy and runtime Skeleton builder.',
    inputSchema: z.object({ projectRoot: z.string(), name: z.string().optional(), output: z.string().optional(), runtimeScript: z.string().optional(), bones: z.array(z.unknown()).optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await generateRig(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_shader', {
    title: 'Create a Godot shader',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Create a Godot shader' },
    description: 'Create a Godot shader source with optional uniforms and custom code.',
    inputSchema: z.object({ projectRoot: z.string(), type: z.enum(['canvas_item','spatial','particles']).default('canvas_item'), output: z.string().optional(), uniforms: z.array(z.unknown()).optional(), code: z.string().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await createShader(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_audio', {
    title: 'Import WAV or MP3 audio',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Import WAV or MP3 audio' },
    description: 'Import a WAV or MP3 from base64 or a local source path into the Godot project.',
    inputSchema: z.object({ projectRoot: z.string(), output: z.string(), base64: z.string().optional(), source: z.string().optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await importAudio(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_input', {
    title: 'Configure Godot input',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Configure Godot input' },
    description: 'Create or update a Godot InputMap action.',
    inputSchema: z.object({ projectRoot: z.string(), action: z.string(), deadzone: z.number().optional(), events: z.array(z.unknown()).optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await configureInput(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_network', {
    title: 'Create multiplayer scaffolding',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Create multiplayer scaffolding' },
    description: 'Generate a Godot 3.x ENet or WebSocket server/client networking scaffold.',
    inputSchema: z.object({ projectRoot: z.string(), mode: z.enum(['enet','websocket']).default('enet'), outputDir: z.string().optional(), port: z.number().int().min(1).max(65535).optional(), maxClients: z.number().int().min(1).max(4096).optional() })
  }, async ({ projectRoot, ...options }) => {
    try { return text(await scaffoldNetwork(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_autoplay', {
    title: 'Run autonomous gameplay tests',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Run autonomous gameplay tests' },
    description: 'Repeat a Behavior.json test and aggregate assertions, frames, checkpoints and failures.',
    inputSchema: z.object({ projectRoot: z.string(), behavior: z.unknown(), runs: z.number().int().min(1).max(50).default(3), stopOnFailure: z.boolean().default(true) })
  }, async ({ projectRoot, behavior, runs, stopOnFailure }) => {
    try { return text(await autoplay(normalizeProjectRoot(projectRoot), { behavior: typeof behavior === 'string' ? behavior : JSON.stringify(behavior), runs, stopOnFailure })); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_studio', {
    title: 'Build a complete game studio workspace',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Build a complete game studio workspace' },
    description: 'Generate animations, models, rigs, shaders, audio, input and networking assets in one atomic studio operation, then validate.',
    inputSchema: z.object({ projectRoot: z.string(), spec: z.unknown(), snapshot: z.boolean().default(true) })
  }, async ({ projectRoot, spec, snapshot }) => {
    try { return text(await createStudioWorkspace(normalizeProjectRoot(projectRoot), { ...(spec as Record<string, unknown>), snapshot })); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_studio_plan', {
    title: 'Run a non-blocking studio plan',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Run a non-blocking studio plan' },
    description: 'Run a potentially long studio generation plan as a background job.',
    inputSchema: z.object({ projectRoot: z.string(), spec: z.unknown() })
  }, async ({ projectRoot, spec }) => {
    try { const root = normalizeProjectRoot(projectRoot); const job = startJob('studio', root, async () => runStudioPlan(root, spec as Record<string, unknown>)); return text(job); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_job_start', {
    title: 'Start a long-running GJM job',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Start a long-running GJM job' },
    description: 'Start a background GJM job without blocking the MCP request. Supports validate, execute, autoplay and studio.',
    inputSchema: z.object({ projectRoot: z.string(), type: z.enum(['validate','execute','autoplay','studio']), payload: z.unknown().optional() })
  }, async ({ projectRoot, type, payload }) => {
    try { const root = normalizeProjectRoot(projectRoot); const p = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {}; const job = startJob(type, root, async () => {
      if (type === 'validate') return validateGodotProject(root);
      if (type === 'execute') return runWorkflow({ projectRoot: root, makeFile: typeof p.makeFile === 'string' ? p.makeFile : undefined, makeContent: typeof p.makeContent === 'string' ? p.makeContent : undefined, behaviorFile: typeof p.behaviorFile === 'string' ? p.behaviorFile : undefined, behaviorContent: typeof p.behaviorContent === 'string' ? p.behaviorContent : undefined, maxAttempts: Number(p.maxAttempts ?? 5), snapshot: p.snapshot !== false });
      if (type === 'autoplay') return autoplay(root, { behavior: typeof p.behavior === 'string' ? p.behavior : JSON.stringify(p.behavior ?? null), runs: Number(p.runs ?? 3), stopOnFailure: p.stopOnFailure !== false });
      return runStudioPlan(root, p.spec && typeof p.spec === 'object' ? p.spec as Record<string, unknown> : p);
    }); return text(job); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_job_status', { title: 'Get GJM job status', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Get GJM job status' }, description: 'Read a background GJM job.', inputSchema: z.object({ jobId: z.string() }) }, async ({ jobId }) => text({ ok: true, code: GJM_CODES.OK, job: getJob(jobId) }));
  server.registerTool('gjm_job_list', { title: 'List GJM jobs', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List GJM jobs' }, description: 'List background GJM jobs.', inputSchema: z.object({ projectRoot: z.string().optional() }) }, async ({ projectRoot }) => text({ ok: true, code: GJM_CODES.OK, jobs: listJobs(projectRoot) }));
  server.registerTool('gjm_job_cancel', { title: 'Cancel a GJM job', annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Cancel a GJM job' }, description: 'Request cancellation of a background GJM job.', inputSchema: z.object({ jobId: z.string() }) }, async ({ jobId }) => text({ ok: true, code: GJM_CODES.OK, job: cancelJob(jobId) }));

  server.registerTool('gjm_parallel', {
    title: 'Run GJM operations in parallel',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, title: 'Run GJM operations in parallel' },
    description: 'Execute independent GJM operations concurrently with a bounded concurrency limit.',
    inputSchema: z.object({ projectRoot: z.string(), jobs: z.array(z.object({ op: z.string(), args: z.unknown().optional() })), maxConcurrency: z.number().int().min(1).max(16).default(4) })
  }, async ({ projectRoot, jobs: parallelJobs, maxConcurrency }) => {
    try { const root = normalizeProjectRoot(projectRoot); const results = await performParallel(parallelJobs as Array<{ op: string; args?: unknown }>, maxConcurrency, async (item) => { const { doAnything } = await import('./ai-anything.js'); return doAnything({ projectRoot: root, steps: [{ id: 'parallel', op: item.op, args: (item.args as Record<string, unknown>) ?? {} }], snapshot: false, stopOnError: true, rollbackOnError: false }); }); return text({ ok: results.every((r:any) => r.ok), code: results.every((r:any) => r.ok) ? GJM_CODES.OK : GJM_CODES.ENVIRONMENT, concurrency: maxConcurrency, results }); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); }
  });

  server.registerTool('gjm_capabilities', {
    title: 'List GJM capabilities',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'List GJM capabilities' },
    description: 'Return the complete high-level capability map and operation aliases available to AI clients.',
    inputSchema: z.object({})
  }, async () => text({
    ok: true,
    code: GJM_CODES.OK,
    capabilities: {
      project: ['create_project', 'project', 'validate', 'export_game'],
      files: ['create_file', 'read_file', 'delete_file', 'create_directory', 'search_text'],
      code: ['create_script', 'patch_script', 'patch_scene', 'scene_operations', 'set_project_setting'],
      content: ['make', 'behavior', 'create_template', 'import_json'],
      runtime: ['run_game', 'test_game', 'inspect_runtime', 'runtime_tree', 'runtime_start', 'runtime', 'runtime_status', 'runtime_stop'],
      media: ['record_video', 'assets', 'assets_import', 'artifacts', 'audio', 'shader'],
      game_content: ['animation', 'animation_edit', 'model', 'rig', 'shader', 'shader_validate', 'audio', 'input', 'input_audit', 'network', 'editor_plugin', 'profile', 'profile_compare', 'network_test', 'generate_wav', 'generate_svg', 'texture'],
      qa: ['behavior', 'autoplay', 'autoplay_fuzz', 'record_video', 'export_mp4', 'assertions', 'audit', 'release_readiness'],
      jobs: ['job_start', 'job_status', 'job_list', 'job_cancel', 'parallel', 'studio', 'studio_plan'],
      debug: ['diagnose', 'prepare_fix', 'apply_fix', 'snapshot_create', 'snapshot_list', 'snapshot_restore', 'snapshot_delete'],
      sessions: ['session_start', 'session_status', 'session_next', 'session_update', 'session_stop'],
      versioning: ['git'],
      orchestration: ['execute', 'do_anything', 'universal', 'godot_script', 'scene_operations', 'context', 'project_index', 'plan', 'transaction', 'dependency_graph'],
      release: ['release']
    }
  }));


  server.registerTool('gjm_dependency_graph', {
    title: 'Build Godot dependency graph',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Build Godot dependency graph' },
    description: 'Analyze project-local scripts, scenes, shaders and resources into a bounded dependency graph for AI reasoning.',
    inputSchema: z.object({ projectRoot: z.string(), maxFiles: z.number().int().min(1).max(10000).default(2000) })
  }, async ({ projectRoot, maxFiles }) => {
    try { return text(await buildDependencyGraph(projectRoot, { maxFiles })); }
    catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });


  server.registerTool('gjm_audit', {
    title: 'Deep-audit a Godot project',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Deep-audit a Godot project' },
    description: 'Build a machine-readable project intelligence report covering files, scenes, scripts, markers, and static structural issues.',
    inputSchema: z.object({ projectRoot: z.string(), maxFiles: z.number().int().min(1).max(20000).default(5000) })
  }, async ({ projectRoot, maxFiles }) => { try { return text(await auditProject(normalizeProjectRoot(projectRoot), { maxFiles })); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_texture', {
    title: 'Generate a procedural PNG texture',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Generate a procedural PNG texture' },
    description: 'Generate dependency-free PNG textures directly into the Godot project.',
    inputSchema: z.object({ projectRoot: z.string(), kind: z.enum(['solid','gradient','checker','noise']).default('gradient'), output: z.string().optional(), width: z.number().int().min(1).max(2048).default(256), height: z.number().int().min(1).max(2048).default(256), color1: z.string().optional(), color2: z.string().optional(), seed: z.number().int().optional() })
  }, async ({ projectRoot, ...options }) => { try { return text(await generateTexture(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_animation_edit', {
    title: 'Edit animation keyframes',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false, title: 'Edit animation keyframes' },
    description: 'Add, remove, move, retime, sort, and update keyframes in a GJM animation manifest.',
    inputSchema: z.object({ projectRoot: z.string(), file: z.string().optional(), action: z.enum(['add_key','remove_key','move_key','set_value','sort']).default('add_key'), trackIndex: z.number().int().min(0).default(0), time: z.number().optional(), fromTime: z.number().optional(), value: z.unknown().optional(), property: z.string().optional() })
  }, async ({ projectRoot, ...options }) => { try { return text(await editAnimation(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_profile_compare', {
    title: 'Compare Godot performance profiles',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Compare Godot performance profiles' },
    description: 'Compare baseline/current GJM profile JSON files and flag meaningful FPS, node-count, and processing regressions.',
    inputSchema: z.object({ projectRoot: z.string(), baseline: z.string().optional(), current: z.string().optional() })
  }, async ({ projectRoot, ...options }) => { try { return text(await profileCompare(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_shader_validate', {
    title: 'Compile-check a Godot shader',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Compile-check a Godot shader' },
    description: 'Use the installed Godot runtime to parse and load shader source, returning stdout/stderr evidence.',
    inputSchema: z.object({ projectRoot: z.string(), shader: z.string().optional(), file: z.string().optional(), godotMajor: z.number().int().min(3).max(5).optional(), timeoutMs: z.number().int().min(1000).max(120000).default(30000) })
  }, async ({ projectRoot, ...options }) => { try { return text(await shaderValidate(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_autoplay_fuzz', {
    title: 'Fuzz gameplay input sequences',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Fuzz gameplay input sequences' },
    description: 'Generate deterministic randomized keyboard input variants from a Behavior.json and repeatedly execute them.',
    inputSchema: z.object({ projectRoot: z.string(), behavior: z.unknown(), runs: z.number().int().min(1).max(50).default(10), seed: z.number().int().optional() })
  }, async ({ projectRoot, ...options }) => { try { return text(await autoplayFuzz(normalizeProjectRoot(projectRoot), options)); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_input_audit', {
    title: 'Audit InputMap actions',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Audit InputMap actions' },
    description: 'Verify requested InputMap action names exist in project.godot.',
    inputSchema: z.object({ projectRoot: z.string(), actions: z.array(z.string()).default([]) })
  }, async ({ projectRoot, actions }) => { try { return text(await inputAudit(normalizeProjectRoot(projectRoot), { actions })); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_release_readiness', {
    title: 'Check release readiness',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Check release readiness' },
    description: 'Run a final project health gate covering project metadata, static errors, source control presence, and total project size.',
    inputSchema: z.object({ projectRoot: z.string() })
  }, async ({ projectRoot }) => { try { return text(await releaseReadiness(normalizeProjectRoot(projectRoot))); } catch (error) { return text({ ok:false, code:GJM_CODES.ENVIRONMENT, message:errorMessage(error) }, true); } });

  server.registerTool('gjm_release', {
    title: 'Build or inspect a GJM release',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'Build or inspect a GJM release' },
    description: 'Create a reproducible project release package, inspect its manifest, or export multiple Godot presets into a release directory.',
    inputSchema: z.object({
      projectRoot: z.string(),
      op: z.enum(['manifest','package','export_matrix']).default('manifest'),
      output: z.string().optional(),
      presets: z.array(z.string()).optional(),
      mode: z.enum(['debug','release']).default('release'),
      timeoutMs: z.number().int().min(1000).max(1800000).default(600000)
    })
  }, async ({ projectRoot, op, output, presets, mode, timeoutMs }) => {
    try {
      const root = normalizeProjectRoot(projectRoot);
      if (op === 'manifest') return text({ ok: true, code: GJM_CODES.OK, manifest: await getReleaseManifest(root) });
      if (op === 'package') return text(await createReleasePackage(root, output));
      return text(await exportMatrix(root, presets ?? [], mode, timeoutMs));
    } catch (error) { return text({ ok: false, code: GJM_CODES.ENVIRONMENT, message: errorMessage(error) }, true); }
  });

  return server;
}
