import { inspectEnvironment } from './environment.js';
import { getGodotMajor } from './godot.js';
export async function doctor() {
    const environment = await inspectEnvironment();
    let godotVersion = null;
    let godotMajor = null;
    try {
        const value = await getGodotMajor();
        godotMajor = value;
        godotVersion = environment.godot?.version ?? null;
    }
    catch { /* report unavailable */ }
    return {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        environment,
        godot: { available: godotMajor !== null, major: godotMajor, version: godotVersion },
        cwd: process.cwd()
    };
}
//# sourceMappingURL=doctor.js.map