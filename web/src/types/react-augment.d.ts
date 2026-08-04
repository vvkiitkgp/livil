// `webkitdirectory` turns a file input into a folder picker. It is non-standard, so React's
// own typings omit it — but it is the only way to offer "choose a folder" as a click rather
// than a drag.
import 'react';

declare module 'react' {
  // The type parameter is unused here but must be declared to merge with React's own
  // generic interface.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
  }
}
