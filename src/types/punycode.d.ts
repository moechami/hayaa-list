// The punycode package (imported as 'punycode/' so Node's deprecated
// built-in module of the same name is never picked up).
declare module 'punycode/' {
  const punycode: { toASCII(input: string): string; toUnicode(input: string): string }
  export default punycode
}
