
"use strict";

const input = document.getElementById("expression");
const resultDisplay = document.getElementById("result");
const statusDisplay = document.getElementById("status");
const keypad = document.getElementById("keypad");

const CONSTANTS = Object.freeze({
  pi: Math.PI,
  e: Math.E
});

const FUNCTIONS = Object.freeze({
  sin: x => Math.sin(x * Math.PI / 180),
  cos: x => Math.cos(x * Math.PI / 180),
  tan: x => {
    const radians = x * Math.PI / 180;

    if (Math.abs(Math.cos(radians)) < 1e-12) {
      throw new Error("Tangent is undefined at this angle");
    }

    return Math.tan(radians);
  },
  sqrt: Math.sqrt,
  log: Math.log10,
  ln: Math.log
});

const MAX_EXPONENT = 1000;
const MAX_INTEGER_BITS = 4096;

let lastAnswer = 0;

// -------------------------------------------------------
// Safe mathematical expression parser
// Does not use eval() or execute JavaScript expressions.
// -------------------------------------------------------

function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }

    const remaining = source.slice(i);

    const number = remaining.match(
      /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
    );

    if (number) {
      const value = Number(number[0]);

      if (!Number.isFinite(value)) {
        throw new Error("Invalid number");
      }

      tokens.push({ type: "number", value });
      i += number[0].length;
      continue;
    }

    const identifier = remaining.match(/^[a-zA-Z]+/);

    if (identifier) {
      tokens.push({
        type: "identifier",
        value: identifier[0].toLowerCase()
      });

      i += identifier[0].length;
      continue;
    }

    if (source.startsWith("**", i)) {
      tokens.push({ type: "operator", value: "^" });
      i += 2;
      continue;
    }

    const character = source[i];

    if ("+-*/%^()".includes(character)) {
      tokens.push({
        type: character === "(" || character === ")"
          ? "parenthesis"
          : "operator",
        value: character
      });
      i++;
      continue;
    }

    throw new Error(`Unsupported character: ${character}`);
  }

  return tokens;
}

function prepareExpression(source) {
  let expression = source
    .replace(/π/g, "pi")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/\*\*/g, "^");

  // Support shorthand such as sqrt9 and sin30.
  expression = expression.replace(
    /\b(sqrt|sin|cos|tan|log|ln)(?!\s*\()(?=[0-9A-Za-z_.])/gi,
    "$1("
  );

  // Automatically close parentheses left open while typing.
  // Extra closing parentheses are still rejected by the parser.
  const difference =
    (expression.match(/\(/g) || []).length -
    (expression.match(/\)/g) || []).length;

  if (difference > 0) {
    expression += ")".repeat(difference);
  }

  return expression;
}

function checked(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Result is outside the supported range");
  }

  if (Number.isInteger(value) && value !== 0) {
    // Estimate the bit length without converting huge numbers
    // to BigInt, which could itself consume excessive resources.
    if (Math.log2(Math.abs(value)) > MAX_INTEGER_BITS) {
      throw new Error("Result too large");
    }
  }

  return value;
}

function evaluateExpression(source) {
  const tokens = tokenize(prepareExpression(source));
  let position = 0;

  function peek() {
    return tokens[position];
  }

  function consume(value) {
    const token = peek();

    if (!token || token.value !== value) {
      throw new Error(`Expected ${value}`);
    }

    position++;
    return token;
  }

  function startsPrimary(token) {
    return token && (
      token.type === "number" ||
      token.type === "identifier" ||
      token.value === "("
    );
  }

  // expression := term (("+" | "-") term)*
  function parseExpression() {
    let value = parseTerm();

    while (peek() && ["+", "-"].includes(peek().value)) {
      const operator = peek().value;
      position++;

      const right = parseTerm();

      value = checked(
        operator === "+" ? value + right : value - right
      );
    }

    return value;
  }

  // term := unary (("*" | "/" | "%" | implicit-multiply) unary)*
  function parseTerm() {
    let value = parseUnary();

    while (peek()) {
      const token = peek();

      if (["*", "/", "%"].includes(token.value)) {
        const operator = token.value;
        position++;

        const right = parseUnary();

        if ((operator === "/" || operator === "%") && right === 0) {
          throw new Error("Cannot divide by zero");
        }

        if (operator === "*") value *= right;
        if (operator === "/") value /= right;
        if (operator === "%") value %= right;

        value = checked(value);
      } else if (startsPrimary(token)) {
        // Examples: 2pi, 2(3+4), 2sqrt(9).
        value = checked(value * parseUnary());
      } else {
        break;
      }
    }

    return value;
  }

  // Unary signs have lower precedence than exponentiation.
  function parseUnary() {
    if (peek() && peek().value === "+") {
      position++;
      return parseUnary();
    }

    if (peek() && peek().value === "-") {
      position++;
      return checked(-parseUnary());
    }

    return parsePower();
  }

  // power := primary ("^" unary)?
  // This supports right-associative exponentiation: 2^3^2 = 512.
  function parsePower() {
    const left = parsePrimary();

    if (peek() && peek().value === "^") {
      position++;
      const right = parseUnary();

      if (Math.abs(right) > MAX_EXPONENT) {
        throw new Error("Exponent too large");
      }

      if (left === 0 && right < 0) {
        throw new Error("Cannot divide by zero");
      }

      return checked(left ** right);
    }

    return left;
  }

  function parsePrimary() {
    const token = peek();

    if (!token) {
      throw new Error("Incomplete expression");
    }

    if (token.type === "number") {
      position++;
      return token.value;
    }

    if (token.value === "(") {
      position++;
      const value = parseExpression();
      consume(")");
      return value;
    }

    if (token.type === "identifier") {
      position++;

      const name = token.value;

      if (Object.hasOwn(CONSTANTS, name)) {
        return CONSTANTS[name];
      }

      if (!Object.hasOwn(FUNCTIONS, name)) {
        throw new Error(`Unknown function or constant: ${name}`);
      }

      consume("(");
      const argument = parseExpression();
      consume(")");

      if (name === "sqrt" && argument < 0) {
        throw new Error("Square root of a negative number");
      }

      if ((name === "log" || name === "ln") && argument <= 0) {
        throw new Error("Logarithm requires a positive number");
      }

      return checked(FUNCTIONS[name](argument));
    }

    throw new Error("Invalid expression");
  }

  if (tokens.length === 0) {
    throw new Error("Enter an expression");
  }

  const value = parseExpression();

  if (position !== tokens.length) {
    throw new Error("Unexpected input");
  }

  return checked(value);
}

// -------------------------------------------------------
// Input editing and cursor positioning
// -------------------------------------------------------

function insertAtCursor(text, cursorOffset = text.length) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;

  input.setRangeText(text, start, end, "select");

  const cursor = start + cursorOffset;
  input.setSelectionRange(cursor, cursor);
  input.focus();

  clearStatus();
}

function insertFunction(name) {
  const text = `${name}()`;

  // Place the cursor immediately after the opening parenthesis.
  insertAtCursor(text, name.length + 1);
}

function backspace() {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;

  if (start !== end) {
    input.setRangeText("", start, end, "start");
  } else if (start > 0) {
    input.setRangeText("", start - 1, start, "start");
  }

  input.focus();
  clearStatus();
}

function toggleSign() {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;

  if (start !== end) {
    const selected = input.value.slice(start, end);
    const replacement = selected.startsWith("-")
      ? selected.slice(1)
      : `-${selected}`;

    insertAtCursor(replacement);
    return;
  }

  const prefix = input.value.slice(0, start);
  const match = prefix.match(/(?:\d+(?:\.\d*)?|\.\d+)$/);

  if (!match) {
    insertAtCursor("-");
    return;
  }

  const numberStart = start - match[0].length;
  const beforeNumber = input.value.slice(0, numberStart);

  if (
    beforeNumber.endsWith("-") &&
    (
      beforeNumber.length === 1 ||
      /[+\-*/^%(]/.test(beforeNumber.at(-2))
    )
  ) {
    const minusPosition = numberStart - 1;
    input.setRangeText(
      "",
      minusPosition,
      minusPosition + 1,
      "start"
    );
    input.setSelectionRange(numberStart - 1, numberStart - 1);
  } else {
    input.setRangeText("-", numberStart, numberStart, "start");
    input.setSelectionRange(start + 1, start + 1);
  }

  input.focus();
  clearStatus();
}

// -------------------------------------------------------
// Display and calculation
// -------------------------------------------------------

function formatResult(value) {
  if (!Number.isFinite(value)) {
    throw new Error("Result is not finite");
  }

  if (Object.is(value, -0)) {
    return "0";
  }

  if (Number.isInteger(value) && Math.abs(value) < 1e16) {
    return String(value);
  }

  return Number(value.toPrecision(12)).toString();
}

function calculate() {
  const source = input.value.trim();

  if (!source) {
    return;
  }

  try {
    const value = evaluateExpression(source);
    const formatted = formatResult(value);

    resultDisplay.textContent = formatted;
    lastAnswer = value;
    statusDisplay.textContent = "DEG · Calculation complete";
    statusDisplay.classList.remove("error");
  } catch (error) {
    resultDisplay.textContent = "Error";
    statusDisplay.textContent =
      error instanceof Error ? error.message : "Invalid expression";
    statusDisplay.classList.add("error");
  }
}

function clearCalculator() {
  input.value = "";
  resultDisplay.textContent = "0";
  lastAnswer = 0;
  clearStatus();
  input.focus();
}

function clearStatus() {
  statusDisplay.textContent = "DEG · Ready";
  statusDisplay.classList.remove("error");
}

// -------------------------------------------------------
// Buttons and keyboard
// -------------------------------------------------------

keypad.addEventListener("mousedown", event => {
  // Keep the expression input focused when clicking a button.
  if (event.target.closest("button")) {
    event.preventDefault();
  }
});

keypad.addEventListener("click", event => {
  const button = event.target.closest("button");

  if (!button) return;

  if (button.dataset.action === "clear") {
    clearCalculator();
    return;
  }

  if (button.dataset.action === "backspace") {
    backspace();
    return;
  }

  if (button.dataset.action === "calculate") {
    calculate();
    return;
  }

  if (button.dataset.action === "sign") {
    toggleSign();
    return;
  }

  if (button.dataset.function) {
    insertFunction(button.dataset.function);
    return;
  }

  if (button.dataset.insert !== undefined) {
    insertAtCursor(button.dataset.insert);
  }
});

input.addEventListener("input", clearStatus);

input.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    calculate();
  } else if (event.key === "Escape") {
    event.preventDefault();
    clearCalculator();
  } else if (event.key === "F9") {
    event.preventDefault();
    toggleSign();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    clearCalculator();
  }
});

// Start ready for keyboard input.
input.focus();
