#!/usr/bin/env python3
"""
Generates samples/sample-exam-50-questions.csv — a 50-question CS 1301 style bank,
2-3 variations each, in TWISTER's whole-exam import format.

Kept as a generator rather than a hand-edited CSV so the file stays valid against
the importer: every question is checked for a unique correct answer, 2-5 choices,
and pinned choices that actually exist before anything is written.

Run: python3 scripts/make-sample-questions.py
"""
import csv
import pathlib
import sys

MAX_CHOICES = 5
NOTA = "None of the above"
AOTA = "All of the above"


def q(points, *variations):
    """A question: (points, [(prompt, [choices], correct_index_0based), ...])."""
    return {"points": points, "variations": list(variations)}


def v(prompt, choices, correct):
    return {"prompt": prompt, "choices": choices, "correct": correct}


def code(body):
    return "```python\n" + body.strip("\n") + "\n```"


QUESTIONS = [
    # ---- 1-5: types and literals ----
    q(1,
      v("What is the type of `3 / 1` in Python 3?", ["`int`", "`float`", "`str`", "`bool`", NOTA], 1),
      v("What is the type of `3 // 1`?", ["`int`", "`float`", "`str`", "`bool`", NOTA], 0),
      v("What is the type of `3 == 1`?", ["`int`", "`float`", "`str`", "`bool`", NOTA], 3)),
    q(1,
      v("What does `int('7') + 1` evaluate to?", ["`8`", "`'71'`", "`71`", "`TypeError`", "`ValueError`"], 0),
      v("What does `'7' + 1` evaluate to?", ["`8`", "`'71'`", "`71`", "`TypeError`", "`ValueError`"], 3),
      v("What does `'7' * 2` evaluate to?", ["`14`", "`'77'`", "`'7 7'`", "`TypeError`", "`ValueError`"], 1)),
    q(1,
      v("What does `float('3.5')` return?", ["`3.5`", "`'3.5'`", "`3`", "`ValueError`", "`TypeError`"], 0),
      v("What does `int('3.5')` return?", ["`3.5`", "`3`", "`4`", "`ValueError`", "`TypeError`"], 3)),
    q(1,
      v("Which of these is a valid Python variable name?", ["`2nd_place`", "`second place`", "`second_place`", "`class`", "`second-place`"], 2),
      v("Which of these is **not** a valid Python variable name?", ["`_total`", "`total2`", "`Total`", "`2total`", "`tOtAl`"], 3)),
    q(1,
      v("What does `type(None)` report?", ["`<class 'NoneType'>`", "`<class 'null'>`", "`<class 'bool'>`", "`<class 'str'>`", "`TypeError`"], 0),
      v("What does `bool(None)` evaluate to?", ["`True`", "`False`", "`None`", "`0`", "`TypeError`"], 1)),

    # ---- 6-12: operators and expressions ----
    q(1,
      v("What does `7 // 2` evaluate to?", ["`3`", "`3.5`", "`4`", "`1`", "`TypeError`"], 0),
      v("What does `7 % 2` evaluate to?", ["`0`", "`1`", "`3`", "`3.5`", "`TypeError`"], 1),
      v("What does `7 / 2` evaluate to?", ["`3`", "`3.5`", "`4`", "`1`", "`TypeError`"], 1)),
    q(1,
      v("What does `-7 // 2` evaluate to?", ["`-3`", "`-4`", "`-3.5`", "`3`", "`4`"], 1),
      v("What does `-7 % 3` evaluate to?", ["`-1`", "`1`", "`2`", "`-2`", "`0`"], 2)),
    q(1,
      v("What does `2 ** 3 ** 2` evaluate to?", ["`64`", "`512`", "`12`", "`36`", "`TypeError`"], 1),
      v("What does `(2 ** 3) ** 2` evaluate to?", ["`64`", "`512`", "`12`", "`36`", "`TypeError`"], 0)),
    q(1,
      v("Which expression evaluates to `True`?", ["`1 == '1'`", "`bool([])`", "`3 in [1, 2, 3]`", "`None > 0`", AOTA], 2),
      v("Which expression evaluates to `False`?", ["`bool('0')`", "`bool([])`", "`1 in [1, 2]`", "`2 == 2.0`", AOTA], 1)),
    q(1,
      v("What does `True and False or True` evaluate to?", ["`True`", "`False`", "`None`", "`SyntaxError`", NOTA], 0),
      v("What does `not (True and False)` evaluate to?", ["`True`", "`False`", "`None`", "`SyntaxError`", NOTA], 0)),
    q(1,
      v("What does `3 < 5 < 4` evaluate to?", ["`True`", "`False`", "`SyntaxError`", "`TypeError`", NOTA], 1),
      v("What does `1 < 2 < 3` evaluate to?", ["`True`", "`False`", "`SyntaxError`", "`TypeError`", NOTA], 0)),
    q(1,
      v("What does `5 if 0 else 6` evaluate to?", ["`5`", "`6`", "`0`", "`True`", "`SyntaxError`"], 1),
      v("What does `5 if 1 else 6` evaluate to?", ["`5`", "`6`", "`0`", "`True`", "`SyntaxError`"], 0)),

    # ---- 13-19: strings ----
    q(1,
      v("What does `'computing'[0:4]` evaluate to?", ["`'comp'`", "`'compu'`", "`'omp'`", "`'c'`", "`IndexError`"], 0),
      v("What does `'computing'[-3:]` evaluate to?", ["`'ing'`", "`'ting'`", "`'ng'`", "`'comput'`", "`IndexError`"], 0),
      v("What does `'computing'[::2]` evaluate to?", ["`'cmuig'`", "`'optn'`", "`'computing'`", "`'gnitupmoc'`", "`TypeError`"], 0)),
    q(1,
      v("What does `'abc'[::-1]` evaluate to?", ["`'cba'`", "`'abc'`", "`'a'`", "`''`", "`IndexError`"], 0),
      v("What does `'abc'[3]` evaluate to?", ["`'c'`", "`''`", "`None`", "`IndexError`", "`KeyError`"], 3)),
    q(1,
      v("What does `len('CS 1301')` return?", ["`6`", "`7`", "`8`", "`4`", NOTA], 1),
      v("What does `len('')` return?", ["`0`", "`1`", "`None`", "`TypeError`", NOTA], 0)),
    q(1,
      v("What does `'Hello'.upper()` return?", ["`'HELLO'`", "`'hello'`", "`'Hello'`", "`None`", "`TypeError`"], 0),
      v("What does `'Hello'.lower()` return?", ["`'HELLO'`", "`'hello'`", "`'Hello'`", "`None`", "`TypeError`"], 1)),
    q(1,
      v("What does `'a,b,c'.split(',')` return?", ["`['a', 'b', 'c']`", "`'abc'`", "`('a', 'b', 'c')`", "`['a,b,c']`", "`TypeError`"], 0),
      v("What does `'-'.join(['a', 'b'])` return?", ["`'a-b'`", "`'ab'`", "`['a', '-', 'b']`", "`'a - b'`", "`TypeError`"], 0)),
    q(1,
      v("What does `'  hi  '.strip()` return?", ["`'hi'`", "`'  hi'`", "`'hi  '`", "`'hi'` with the spaces kept", "`None`"], 0),
      v("What does `'banana'.replace('a', 'o')` return?", ["`'bonono'`", "`'bonana'`", "`'banana'`", "`'onnn'`", "`None`"], 0)),
    q(1,
      v("What does `'cat' in 'concatenate'` evaluate to?", ["`True`", "`False`", "`3`", "`TypeError`", NOTA], 0),
      v("What does `'dog' in 'concatenate'` evaluate to?", ["`True`", "`False`", "`-1`", "`TypeError`", NOTA], 1)),

    # ---- 20-27: lists ----
    q(1,
      v("What does the following print?\n\n" + code("xs = [1, 2, 3]\nprint(len(xs))"), ["`1`", "`2`", "`3`", "`TypeError`", NOTA], 2),
      v("What does the following print?\n\n" + code("xs = [4, 5]\nprint(len(xs))"), ["`1`", "`2`", "`3`", "`TypeError`", NOTA], 1),
      v("What does the following print?\n\n" + code("xs = []\nprint(len(xs))"), ["`0`", "`1`", "`None`", "`TypeError`", NOTA], 0)),
    q(2,
      v("What does the following print?\n\n" + code("a = [1, 2]\nb = a\nb.append(3)\nprint(len(a))"), ["`1`", "`2`", "`3`", "`4`", "`TypeError`"], 2),
      v("What does the following print?\n\n" + code("a = [1, 2]\nb = a[:]\nb.append(3)\nprint(len(a))"), ["`1`", "`2`", "`3`", "`4`", "`TypeError`"], 1)),
    q(1,
      v("What does `[1, 2] + [3]` evaluate to?", ["`[1, 2, 3]`", "`[1, 2, [3]]`", "`[4, 2]`", "`TypeError`", NOTA], 0),
      v("What does `[1, 2] * 2` evaluate to?", ["`[1, 2, 1, 2]`", "`[2, 4]`", "`[1, 2, 2]`", "`TypeError`", NOTA], 0)),
    q(1,
      v("What does the following print?\n\n" + code("xs = [1, 2, 3]\nxs.insert(1, 9)\nprint(xs)"), ["`[1, 9, 2, 3]`", "`[9, 1, 2, 3]`", "`[1, 2, 9, 3]`", "`[1, 2, 3, 9]`", "`TypeError`"], 0),
      v("What does the following print?\n\n" + code("xs = [1, 2, 3]\nxs.pop(0)\nprint(xs)"), ["`[2, 3]`", "`[1, 2]`", "`[1, 3]`", "`[1, 2, 3]`", "`TypeError`"], 0)),
    q(1,
      v("What does `sorted([3, 1, 2])` return?", ["`[1, 2, 3]`", "`[3, 2, 1]`", "`None`", "`[3, 1, 2]`", "`TypeError`"], 0),
      v("What does `[3, 1, 2].sort()` return?", ["`[1, 2, 3]`", "`[3, 2, 1]`", "`None`", "`[3, 1, 2]`", "`TypeError`"], 2)),
    q(1,
      v("What does `[1, 2, 3][1:]` evaluate to?", ["`[2, 3]`", "`[1, 2]`", "`[1]`", "`[3]`", "`IndexError`"], 0),
      v("What does `[1, 2, 3][:-1]` evaluate to?", ["`[1, 2]`", "`[2, 3]`", "`[3]`", "`[1]`", "`IndexError`"], 0)),
    q(1,
      v("What does `sum([1, 2, 3])` return?", ["`6`", "`3`", "`[1, 2, 3]`", "`123`", "`TypeError`"], 0),
      v("What does `max([1, 5, 3])` return?", ["`5`", "`1`", "`3`", "`9`", "`TypeError`"], 0)),
    q(1,
      v("What does `list('abc')` return?", ["`['a', 'b', 'c']`", "`['abc']`", "`'abc'`", "`[abc]`", "`TypeError`"], 0),
      v("What does `list(range(3))` return?", ["`[0, 1, 2]`", "`[1, 2, 3]`", "`[0, 1, 2, 3]`", "`range(3)`", "`TypeError`"], 0)),

    # ---- 28-33: loops and ranges ----
    q(1,
      v("How many times does the body of this loop run?\n\n" + code("for i in range(2, 10, 3):\n    print(i)"), ["`2`", "`3`", "`4`", "`8`", NOTA], 1),
      v("How many times does the body of this loop run?\n\n" + code("for i in range(0, 10, 2):\n    print(i)"), ["`2`", "`4`", "`5`", "`10`", NOTA], 2),
      v("How many times does the body of this loop run?\n\n" + code("for i in range(5):\n    print(i)"), ["`4`", "`5`", "`6`", "`0`", NOTA], 1)),
    q(1,
      v("What is the last value printed?\n\n" + code("for i in range(3):\n    print(i)"), ["`0`", "`1`", "`2`", "`3`", "nothing is printed"], 2),
      v("What is the first value printed?\n\n" + code("for i in range(1, 4):\n    print(i)"), ["`0`", "`1`", "`2`", "`4`", "nothing is printed"], 1)),
    q(1,
      v("What does the following print?\n\n" + code("total = 0\nfor i in [1, 2, 3]:\n    total += i\nprint(total)"), ["`3`", "`6`", "`0`", "`[1, 2, 3]`", "`TypeError`"], 1),
      v("What does the following print?\n\n" + code("total = 1\nfor i in [1, 2, 3]:\n    total *= i\nprint(total)"), ["`6`", "`3`", "`1`", "`0`", "`TypeError`"], 0)),
    q(1,
      v("What does the following print?\n\n" + code("i = 0\nwhile i < 3:\n    i += 1\nprint(i)"), ["`2`", "`3`", "`4`", "the loop never ends", "`0`"], 1),
      v("What does the following print?\n\n" + code("i = 0\nwhile i < 3:\n    i += 2\nprint(i)"), ["`2`", "`3`", "`4`", "the loop never ends", "`0`"], 2)),
    q(1,
      v("What does the following print?\n\n" + code("for i in range(5):\n    if i == 2:\n        break\nprint(i)"), ["`1`", "`2`", "`4`", "`5`", "nothing"], 1),
      v("What does the following print?\n\n" + code("count = 0\nfor i in range(5):\n    if i == 2:\n        continue\n    count += 1\nprint(count)"), ["`3`", "`4`", "`5`", "`2`", "nothing"], 1)),
    q(1,
      v("How many lines does this nested loop print?\n\n" + code("for i in range(3):\n    for j in range(2):\n        print(i, j)"), ["`5`", "`6`", "`3`", "`2`", "`9`"], 1),
      v("How many lines does this nested loop print?\n\n" + code("for i in range(4):\n    for j in range(3):\n        print(i, j)"), ["`7`", "`12`", "`4`", "`3`", "`9`"], 1)),

    # ---- 34-38: conditionals ----
    q(1,
      v("What does the following print?\n\n" + code("x = 5\nif x > 3:\n    print('big')\nelif x > 1:\n    print('medium')\nelse:\n    print('small')"), ["`big`", "`medium`", "`small`", "`big` and `medium`", "nothing"], 0),
      v("What does the following print?\n\n" + code("x = 2\nif x > 3:\n    print('big')\nelif x > 1:\n    print('medium')\nelse:\n    print('small')"), ["`big`", "`medium`", "`small`", "`medium` and `small`", "nothing"], 1)),
    q(1,
      v("Which values of `x` make `if x:` run its body?", ["`0`", "`''`", "`[]`", "`'0'`", "`None`"], 3),
      v("Which values of `x` make `if not x:` run its body?", ["`1`", "`'a'`", "`[0]`", "`[]`", "`True`"], 3)),
    q(1,
      v("What does the following print?\n\n" + code("x = 4\nif x % 2 == 0:\n    print('even')\nelse:\n    print('odd')"), ["`even`", "`odd`", "both", "nothing", "`SyntaxError`"], 0),
      v("What does the following print?\n\n" + code("x = 7\nif x % 2 == 0:\n    print('even')\nelse:\n    print('odd')"), ["`even`", "`odd`", "both", "nothing", "`SyntaxError`"], 1)),
    q(1,
      v("What does the following print?\n\n" + code("x = 10\nif x > 5:\n    if x > 20:\n        print('a')\n    else:\n        print('b')\nelse:\n    print('c')"), ["`a`", "`b`", "`c`", "nothing", "`SyntaxError`"], 1),
      v("What does the following print?\n\n" + code("x = 30\nif x > 5:\n    if x > 20:\n        print('a')\n    else:\n        print('b')\nelse:\n    print('c')"), ["`a`", "`b`", "`c`", "nothing", "`SyntaxError`"], 0)),
    q(1,
      v("What is printed?\n\n" + code("x = 3\nif x == 3:\n    pass\nprint('done')"), ["`done`", "`3`", "nothing", "`SyntaxError`", "`NameError`"], 0),
      v("What is printed?\n\n" + code("x = 3\nif x = 3:\n    print('yes')"), ["`yes`", "`3`", "nothing", "`SyntaxError`", "`NameError`"], 3)),

    # ---- 39-44: functions and scope ----
    q(1,
      v("What does `f(3)` return?\n\n" + code("def f(n):\n    if n > 2:\n        n = n * 2\n    return n"), ["`3`", "`6`", "`None`", "`2`", NOTA], 1),
      v("What does `f(1)` return?\n\n" + code("def f(n):\n    if n > 2:\n        n = n * 2\n    return n"), ["`1`", "`2`", "`None`", "`0`", NOTA], 0),
      v("What does `f(4)` return?\n\n" + code("def f(n):\n    if n > 2:\n        n = n * 2"), ["`4`", "`8`", "`None`", "`2`", NOTA], 2)),
    q(1,
      v("What does the following print?\n\n" + code("x = 10\n\ndef f():\n    x = 20\n\nf()\nprint(x)"), ["`10`", "`20`", "`None`", "`NameError`", NOTA], 0),
      v("What does the following print?\n\n" + code("x = 10\n\ndef f():\n    global x\n    x = 20\n\nf()\nprint(x)"), ["`10`", "`20`", "`None`", "`NameError`", NOTA], 1)),
    q(1,
      v("What does `g(2)` return?\n\n" + code("def g(n, k=3):\n    return n + k"), ["`2`", "`3`", "`5`", "`None`", "`TypeError`"], 2),
      v("What does `g(2, 10)` return?\n\n" + code("def g(n, k=3):\n    return n + k"), ["`2`", "`5`", "`12`", "`None`", "`TypeError`"], 2)),
    q(1,
      v("What does the following print?\n\n" + code("def f():\n    return 1\n    return 2\n\nprint(f())"), ["`1`", "`2`", "`3`", "`None`", "`SyntaxError`"], 0),
      v("What does the following print?\n\n" + code("def f():\n    print(1)\n    return\n    print(2)\n\nf()"), ["`1`", "`2`", "`1` then `2`", "`None`", "`SyntaxError`"], 0)),
    q(1,
      v("What does `h(3)` return?\n\n" + code("def h(n):\n    if n <= 1:\n        return 1\n    return n * h(n - 1)"), ["`3`", "`6`", "`9`", "`1`", "infinite recursion"], 1),
      v("What does `h(4)` return?\n\n" + code("def h(n):\n    if n <= 1:\n        return 1\n    return n * h(n - 1)"), ["`10`", "`16`", "`24`", "`4`", "infinite recursion"], 2)),
    q(1,
      v("What happens when `f()` is called?\n\n" + code("def f(a, b):\n    return a + b\n\nf(1)"), ["returns `1`", "returns `None`", "`TypeError`", "`NameError`", "`SyntaxError`"], 2),
      v("What happens when this runs?\n\n" + code("def f(a, b=2):\n    return a + b\n\nprint(f(1))"), ["prints `1`", "prints `3`", "`TypeError`", "`NameError`", "`SyntaxError`"], 1)),

    # ---- 45-50: dicts, tuples, mutability, errors ----
    q(1,
      v("What does the following print?\n\n" + code('d = {"a": 1, "b": 2}\nprint(d.get("c", 0))'), ["`0`", "`None`", "`KeyError`", "`2`", "`'c'`"], 0),
      v("What does the following print?\n\n" + code('d = {"a": 1, "b": 2}\nprint(d["c"])'), ["`0`", "`None`", "`KeyError`", "`2`", "`'c'`"], 2)),
    q(1,
      v("What does `len({'a': 1, 'b': 2})` return?", ["`1`", "`2`", "`4`", "`0`", "`TypeError`"], 1),
      v("What does `list({'a': 1, 'b': 2})` return?", ["`['a', 'b']`", "`[1, 2]`", "`[('a', 1), ('b', 2)]`", "`{'a', 'b'}`", "`TypeError`"], 0)),
    q(1,
      v("Which of these is **mutable** in Python?", ["`tuple`", "`str`", "`list`", "`int`"], 2),
      v("Which of these is **immutable** in Python?", ["`list`", "`dict`", "`set`", "`tuple`"], 3)),
    q(1,
      v("What does the following print?\n\n" + code("t = (1, 2)\nt[0] = 5\nprint(t)"), ["`(5, 2)`", "`(1, 2)`", "`[5, 2]`", "`TypeError`", "`IndexError`"], 3),
      v("What does the following print?\n\n" + code("t = (1, 2)\nprint(t + (3,))"), ["`(1, 2, 3)`", "`(1, 2, (3,))`", "`[1, 2, 3]`", "`TypeError`", "`IndexError`"], 0)),
    q(1,
      v("What does the following print?\n\n" + code("try:\n    print(1 / 0)\nexcept ZeroDivisionError:\n    print('caught')"), ["`caught`", "`0`", "`inf`", "the program crashes", NOTA], 0),
      v("What does the following print?\n\n" + code("try:\n    print(int('x'))\nexcept ValueError:\n    print('caught')"), ["`caught`", "`0`", "`x`", "the program crashes", NOTA], 0)),
    q(1,
      v("What does `[i * 2 for i in range(3)]` evaluate to?", ["`[0, 2, 4]`", "`[2, 4, 6]`", "`[0, 1, 2]`", "`[1, 2, 3]`", "`TypeError`"], 0),
      v("What does `[i for i in range(5) if i % 2 == 0]` evaluate to?", ["`[0, 2, 4]`", "`[1, 3]`", "`[0, 1, 2, 3, 4]`", "`[2, 4]`", "`TypeError`"], 0)),
]


def validate(questions):
    """Refuses to write a file the importer would reject."""
    problems = []
    for i, question in enumerate(questions, start=1):
        if not question["variations"]:
            problems.append(f"Q{i}: no variations")
        for var in question["variations"]:
            n = len(var["choices"])
            if not 2 <= n <= MAX_CHOICES:
                problems.append(f"Q{i}: {n} choices (must be 2-{MAX_CHOICES})")
            if not 0 <= var["correct"] < n:
                problems.append(f"Q{i}: correct index {var['correct']} out of range")
            if len(set(var["choices"])) != n:
                problems.append(f"Q{i}: duplicate choice text")
            if not var["prompt"].strip():
                problems.append(f"Q{i}: empty prompt")
    return problems


def main():
    problems = validate(QUESTIONS)
    if problems:
        print("Refusing to write; fix these first:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1

    out = pathlib.Path("samples/sample-exam-50-questions.csv")
    out.parent.mkdir(exist_ok=True)

    header = ["question_number", "points", "variation_label", "prompt"] + \
             [f"choice_{i + 1}" for i in range(MAX_CHOICES)] + ["correct", "pin_last"]

    rows = []
    for number, question in enumerate(QUESTIONS, start=1):
        for index, var in enumerate(question["variations"]):
            choices = var["choices"]
            # "None/All of the above" must stay in the last slot when shuffled.
            pinned = [str(i + 1) for i, c in enumerate(choices) if c in (NOTA, AOTA)]
            row = [number, question["points"], chr(ord("A") + index), var["prompt"]]
            row += list(choices) + [""] * (MAX_CHOICES - len(choices))
            row += [var["correct"] + 1, " ".join(pinned)]
            rows.append(row)

    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)

    variations = sum(len(q["variations"]) for q in QUESTIONS)
    short = sum(1 for q in QUESTIONS for v in q["variations"] if len(v["choices"]) < MAX_CHOICES)
    print(f"wrote {out}")
    print(f"  {len(QUESTIONS)} questions, {variations} variations, {len(rows)} rows")
    print(f"  {short} variation(s) with fewer than {MAX_CHOICES} choices")
    return 0


if __name__ == "__main__":
    sys.exit(main())
