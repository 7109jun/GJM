export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }

export interface MakeDirectoryAction {
  type: 'directory';
  path: string;
}

export interface MakeFileAction {
  type: 'file' | 'script';
  path: string;
  content: string;
  encoding?: 'utf8';
}

export interface MakeProjectSettingAction {
  type: 'project_setting';
  section: string;
  key: string;
  value: JsonValue;
}

export interface MakeNodeSpec {
  name: string;
  type: string;
  parent?: string;
  script?: string;
  properties?: Record<string, JsonValue>;
}

export interface MakeSceneAction {
  type: 'scene';
  path: string;
  root?: { name?: string; type?: string; script?: string; properties?: Record<string, JsonValue> };
  nodes?: MakeNodeSpec[];
  script?: string;
}

export type MakeAction =
  | MakeDirectoryAction
  | MakeFileAction
  | MakeProjectSettingAction
  | MakeSceneAction;

export interface GodotMake {
  format: 'godot.make';
  version: number;
  name?: string;
  description?: string;
  project?: {
    name?: string;
    config_version?: number;
    [key: string]: unknown;
  };
  actions: MakeAction[];
}

export type BehaviorKeyAction = {
  type: 'key_down' | 'key_up' | 'key_press';
  key: string;
  durationMs?: number;
};

export type BehaviorMouseAction = {
  type: 'mouse_move' | 'mouse_down' | 'mouse_up' | 'click' | 'double_click';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
};

export type BehaviorScroll = {
  type: 'scroll';
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
};

export type BehaviorWait = { type: 'wait'; ms: number };
export type BehaviorScreenshot = { type: 'screenshot'; name?: string };
export type BehaviorAction = BehaviorWait | BehaviorKeyAction | BehaviorMouseAction | BehaviorScroll | BehaviorScreenshot;

export type BehaviorAssertion =
  | { type: 'frames_min'; value: number }
  | { type: 'checkpoint'; name: string }
  | { type: 'stdout_contains'; value: string }
  | { type: 'stderr_not_contains'; value: string }
  | { type: 'file_exists'; path: string }
  | { type: 'file_contains'; path: string; value: string };

export interface BehaviorFile {
  format: 'godot.behavior';
  version: number;
  name?: string;
  description?: string;
  actions: BehaviorAction[];
  assertions?: BehaviorAssertion[];
  capture?: {
    fps?: number;
    width?: number;
    height?: number;
    outputName?: string;
  };
}

export interface CommandResult {
  code: number;
  signal?: string;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface GjmResult {
  ok: boolean;
  code: string;
  phase?: string;
  message: string;
  data?: unknown;
}

export type JsonImportKind = "make" | "behavior";
