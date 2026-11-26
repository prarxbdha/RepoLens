// @module sample.js
const path = require("path");

import { readFile as read } from "node:fs";
import * as utils from "./utils.js";

/** Adds two numbers. */
export function add(a, b = 1) {
  return a + b;
}

export const ANSWER = 42;
let counter = 0;

export default class Calculator {
  constructor(value) {
    this.value = value;
  }

  /** Multiplies values. */
  async multiply(factor) {
    if (factor > 1) {
      return this.value * factor;
    }
    return this.value;
  }

  static create() {
    return new Calculator(1);
  }
}

module.exports = { add, ANSWER };
exports.multiply = Calculator.prototype.multiply;
