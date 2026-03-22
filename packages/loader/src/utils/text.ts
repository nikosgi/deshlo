export function splitMeaningfulText(
  value: string
): {
  leading: string;
  text: string;
  trailing: string;
} | null {
  let firstNonWhitespace = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index].trim() !== "") {
      firstNonWhitespace = index;
      break;
    }
  }

  if (firstNonWhitespace === -1) {
    return null;
  }

  let lastNonWhitespace = -1;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index].trim() !== "") {
      lastNonWhitespace = index;
      break;
    }
  }

  if (lastNonWhitespace === -1) {
    return null;
  }

  return {
    leading: value.slice(0, firstNonWhitespace),
    text: value.slice(firstNonWhitespace, lastNonWhitespace + 1),
    trailing: value.slice(lastNonWhitespace + 1),
  };
}

export function advanceLocation(
  start: { line: number; column: number },
  value: string
): { line: number; column: number } {
  let line = start.line;
  let column = start.column;

  for (const character of value) {
    if (character === "\n") {
      line += 1;
      column = 0;
      continue;
    }

    if (character === "\r") {
      continue;
    }

    column += 1;
  }

  return { line, column };
}
