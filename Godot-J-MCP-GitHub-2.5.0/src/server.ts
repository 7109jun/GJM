import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
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

function text(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}
async function loadJson(root: string, relative: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(safeProjectPath(root, relative), 'utf8')) as unknown;
}

export function createServer() {
  const server = new McpServer(
    { name: 'Godot-J-MCP', version: '2.5.0' },
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
          actionTypes: ['directory', 'file', 'script', 'project_setting', 'scene'],
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
          actionTypes: ['wait', 'key_down', 'key_up', 'key_press', 'mouse_move', 'mouse_down', 'mouse_up', 'click', 'double_click', 'scroll', 'screenshot'],
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

  server.registerTool('gjm_server_info', {
    title: 'GJM server information',
    description: 'Return GJM protocol-facing server metadata, capabilities, supported formats, and workflow entry points.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: 'GJM server information' },
    inputSchema: z.object({})
  }, async () => {
    return text({
      ok: true,
      code: GJM_CODES.OK,
      server: { name: 'Godot-J-MCP', version: '2.5.0', protocol: 'MCP', transport: 'stdio' },
      workflows: ['gjm_execute', 'gjm_pipeline'],
      formats: ['godot.make.json', 'Behavior.json', '.gjm_last_result.json'],
      features: ['sessions', 'snapshots', 'AI-diagnosis', 'AI-repair', 'assertions', 'artifacts', 'MP4-export', 'uploaded-JSON-import']
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

  return server;
}
