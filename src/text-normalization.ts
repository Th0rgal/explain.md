export function tokenizeNormalized(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ing") && token.length > 6) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("es") && token.length > 5) {
    const stemByEs = token.slice(0, -2);
    if (/(?:s|x|z|ch|sh)$/.test(stemByEs)) {
      return stemByEs;
    }
    const stemByS = token.slice(0, -1);
    if (stemByS.endsWith("e")) {
      return stemByS;
    }
    return stemByEs;
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}
