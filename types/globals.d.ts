// Global ambient declarations for StudyForge browser & runtime globals
declare const supabase: any;
declare const pdfjsLib: any;
declare const Cropper: any;
declare const marked: any;
declare const process: any;
declare const Buffer: any;
declare function require(id: string): any;

interface Window {
  [key: string]: any;
}

interface HTMLElement {
  value?: any;
  disabled?: boolean;
  src?: string;
  href?: string;
  files?: any;
  placeholder?: string;
  checked?: boolean;
}

interface EventTarget {
  value?: any;
  files?: any;
  checked?: boolean;
}

interface Error {
  status?: number;
}

declare module 'node:crypto' {
  const crypto: any;
  export default crypto;
}
declare module 'fs' {
  const fs: any;
  export = fs;
}
declare module 'https' {
  const https: any;
  export = https;
}
