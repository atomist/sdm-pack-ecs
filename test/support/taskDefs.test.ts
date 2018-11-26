import * as assert from "assert";
import { cmpSuppliedTaskDefinition } from "../../lib/support/taskDefs";

describe("cmpSuppliedTaskDefinition", () => {
    describe("compare two identical objects", () => {
        it("should return true", () => {
            const obj1 = { a: 1, b: 2, c: "string"};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, true);
        });
    });

    describe("compare two objects, first matching subset of second", () => {
        it("should return true", () => {
            const obj1 = { a: 1};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, true);
        });
    });

    describe("compare two objects, first non-matching subset of second", () => {
        it("should return false", () => {
            const obj1 = { a: 3};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, false);
        });
    });

    describe("compare two objects, non-matching", () => {
        it("should return false", () => {
            const obj1 = { y: 3};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, false);
        });
    });
});
