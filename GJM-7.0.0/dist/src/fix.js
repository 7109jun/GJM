import fs from 'node:fs/promises';
import { safeProjectPath } from './fs-safe.js';
import { validateMake } from './validate.js';
import { applyMake } from './make.js';
import { getGodotMajor, validateGodotProject } from './godot.js';
import { diagnoseLastResult } from './diagnostics.js';
import { writeRunResult } from './results.js';
export async function prepareFixContext(projectRoot, maxSnippetLines = 16) {
    const diagnosis = await diagnoseLastResult(projectRoot, maxSnippetLines);
    let makeContent;
    const makePath = safeProjectPath(projectRoot, 'godot.make.json');
    try {
        makeContent = await fs.readFile(makePath, 'utf8');
    }
    catch {
        // Inline make input may have been used; nothing to read from disk.
    }
    return {
        ok: true,
        readyForAiRepair: !diagnosis.ok,
        diagnosis,
        currentMakeContent: makeContent,
        repairContract: {
            tool: 'gjm_apply_fix',
            requiredArgument: 'makeContent',
            behavior: 'Provide a complete corrected godot.make.json document. GJM will validate, apply, and run Godot validation again.',
        },
    };
}
export async function applyFix(projectRoot, makeContent) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const make = validateMake(JSON.parse(makeContent));
    await fs.writeFile(safeProjectPath(projectRoot, 'godot.make.json'), `${JSON.stringify(make, null, 2)}\n`, 'utf8');
    const major = await getGodotMajor();
    const changes = await applyMake(projectRoot, make, false, major);
    const validation = await validateGodotProject(projectRoot);
    const ok = validation.code === 0;
    const result = {
        ok,
        phase: ok ? 'fix-validated' : 'validate',
        code: ok ? 'GJM-OK' : 'GJM-E201',
        changes,
        exitCode: validation.code,
        stdout: validation.stdout,
        stderr: validation.stderr,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedMs,
        next: ok
            ? { action: 'provide_behavior', message: 'Fix applied and Godot validation succeeded. Provide Behavior.json to continue runtime testing.' }
            : { action: 'diagnose', tool: 'gjm_diagnose' },
    };
    await writeRunResult(projectRoot, result);
    return result;
}
//# sourceMappingURL=fix.js.map