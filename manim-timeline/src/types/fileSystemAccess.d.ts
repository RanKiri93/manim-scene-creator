/**
 * File System Access API — keeps `tsc -b` / production builds happy when lib.dom
 * typings for pickers / handle permissions lag the browser API surface.
 */
export {};

declare global {
  interface FilePickerAcceptType {
    description: string;
    accept: Record<string, string | string[]>;
  }

  interface OpenFilePickerOptions {
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
    mode?: 'read' | 'readwrite';
  }

  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }

  interface FileSystemFileHandle {
    queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
    requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  }

  interface Window {
    showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
  }
}
