// "solve for x": a random linear equation with parentheses, nested brackets and x on both sides, whose
// answer is always a whole number. used by the Solve for X prize (mysterybox.ts / quickRevive.ts).
//
// run it on its own to see what it makes:
//     npx ts-node src/algebra.ts          (five of each difficulty)
//     npx ts-node src/algebra.ts 3 20     (twenty at difficulty 3)
//
// how it stays solvable: every expression is built as a tree that is LINEAR in x — numbers, x, k·x, sums,
// differences, and a number times a bracket, but never x times x — so each one reduces to a·x + b. the
// answer is picked first; the two sides are generated; then the right side gets whatever constant makes the
// picked answer true. a side pair whose x terms cancel (no single answer) is thrown away and drawn again.

type Lin = { a: number, b: number };              // a·x + b
type Node = { text: string, lin: Lin, atom: boolean }; // atom = safe to put a coefficient in front of / negate without brackets

function rint(lo: number, hi: number): number {
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function pick<T>(xs: T[]): T {
    return xs[Math.floor(Math.random() * xs.length)];
}

function num(n: number): Node {
    return { text: String(n), lin: { a: 0, b: n }, atom: true };
}

function xTerm(k: number): Node {
    return { text: k === 1 ? "x" : `${k}x`, lin: { a: k, b: 0 }, atom: true };
}

// a leaf: a small number, x, or a few x. `noX` when the group already has an x term — two of them side by
// side ("x - x", "3x + 5x") reads as a mistake rather than as something to simplify.
function leaf(noX = false): Node {
    const r = Math.random();
    if (noX || r < 0.4)
        return num(rint(1, 12));
    if (r < 0.65)
        return xTerm(1);
    return xTerm(rint(2, 9));
}

function wrap(n: Node, brackets: [string, string]): Node {
    return { text: `${brackets[0]}${n.text}${brackets[1]}`, lin: n.lin, atom: true };
}

// a ± b, written with a plain minus when b would otherwise be "+ -3"
function sum(l: Node, r: Node, minus: boolean): Node {
    return {
        text: `${l.text} ${minus ? "-" : "+"} ${r.text}`,
        lin: { a: l.lin.a + (minus ? -r.lin.a : r.lin.a), b: l.lin.b + (minus ? -r.lin.b : r.lin.b) },
        atom: false,
    };
}

// k(…) — a number times a bracket. the only multiplication there is, which is what keeps it linear.
function times(k: number, inner: Node, brackets: [string, string]): Node {
    return { text: `${k}${wrap(inner, brackets).text}`, lin: { a: k * inner.lin.a, b: k * inner.lin.b }, atom: true };
}

// a random linear expression. `depth` is how many more levels of brackets it may nest; the outermost
// brackets of a nested group are square so the eye can match them up.
function expr(depth: number, terms: number): Node {
    const parts: Node[] = [];
    let hasX = false;
    for (let i = 0; i < terms; i++){
        if (depth > 0 && Math.random() < 0.6){
            const inner = expr(depth - 1, rint(2, 3));
            const brackets: [string, string] = depth >= 2 ? ["[", "]"] : ["(", ")"];
            parts.push(Math.random() < 0.8 ? times(rint(2, 6), inner, brackets) : wrap(inner, brackets));
        } else {
            const l = leaf(hasX);
            hasX = hasX || l.lin.a !== 0;
            parts.push(l);
        }
    }
    let out = parts[0];
    for (let i = 1; i < parts.length; i++)
        out = sum(out, parts[i], Math.random() < 0.45);
    return out;
}

// −1000…1000, but never a small one: anything from −20 to 20 is exactly what a chat spamming numbers would
// hit by luck, so those are drawn again
function answerDraw(): number {
    for (;;){
        const x = rint(-1000, 1000);
        if (Math.abs(x) > 20)
            return x;
    }
}

export interface Equation {
    text: string     // what goes up on screen, e.g. "3(2x - 5) - [4(x + 7) - x] = 2(x - 9) + 13"
    answer: number   // the whole-number x that solves it
}

// difficulty 1: one level of brackets, x on the left only. 2: x on both sides. 3: nested [ ( ) ] brackets
// and more terms. the answer is anywhere from −1000 to 1000, so chat can't just fire off 1 through 10
// and win without doing the algebra — the last step is a real division.
export function makeEquation(difficulty = 2): Equation {
    const d = Math.min(3, Math.max(1, Math.round(difficulty)));
    for (let tries = 0; tries < 200; tries++){
        const x = answerDraw();
        const left = expr(d >= 3 ? 2 : 1, d === 1 ? 2 : 3);
        const right = d === 1 ? num(0) : expr(1, d >= 3 ? 3 : 2);
        const net = left.lin.a - right.lin.a;
        if (net === 0)
            continue; // x cancels out: no single answer
        if (Math.abs(net) > 40)
            continue; // solvable, but the arithmetic stops being fun
        // whatever constant the right side needs for x to be the answer
        const k = (left.lin.a * x + left.lin.b) - (right.lin.a * x + right.lin.b);
        let rhs: string;
        if (d === 1)
            rhs = String(k);
        else if (k === 0)
            rhs = right.text;
        else
            rhs = `${right.text} ${k < 0 ? "-" : "+"} ${Math.abs(k)}`;
        const text = `${left.text} = ${rhs}`;
        if (text.length > 110)
            continue; // has to fit on the overlay and in one chat line
        return { text, answer: x };
    }
    // the draw above essentially never fails 200 times; this is just a floor that's always valid
    const x = answerDraw();
    return { text: `3(x + 4) - 2(x - 1) = ${x + 14}`, answer: x };
}

// what somebody typed, as an answer: "7", "-3", "x=7", "x = -3", "x is 7"… null when it isn't one
export function readAnswer(text: string): number | null {
    // "1,000" and "-1 000" are how people write big numbers; the separators go before it's read
    const m = String(text || "").trim().toLowerCase()
        .match(/^(?:x\s*(?:=|is)\s*)?(-?\s*\d{1,3}(?:[,\s]\d{3})*|-?\s*\d+)\s*[!.?]*$/);
    return m ? Number(m[1].replace(/[\s,]+/g, "")) : null;
}

// --- run directly: print some equations, checking each one's answer really solves it ---------------------
if (require.main === module){
    const args = process.argv.slice(2).map(Number);
    const levels = args[0] ? [args[0]] : [1, 2, 3];
    const count = args[1] || 5;
    for (const d of levels){
        console.log(`difficulty ${d}:`);
        for (let i = 0; i < count; i++){
            const eq = makeEquation(d);
            // independent check: evaluate both sides at the answer from the TEXT, not from the tree
            const [l, r] = eq.text.split("=").map((side) => side
                .replace(/\[/g, "(").replace(/\]/g, ")")
                .replace(/(\d)\s*x/g, "$1*x")
                .replace(/(\d)\s*\(/g, "$1*(")
                .replace(/\bx\b/g, `(${eq.answer})`));
            // eslint-disable-next-line no-new-func
            const ok = Function(`return (${l}) === (${r})`)();
            console.log(`  ${eq.text}    x = ${eq.answer}${ok ? "" : "   <-- WRONG"}`);
        }
    }
}
