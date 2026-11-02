import {
  matchesLength,
  type Language,
  type Length,
  type Snippet,
} from "./types";

type Random = () => number;
interface Recipe {
  family: string;
  title: string;
  description: string;
  render: (language: Language, random: Random) => string;
}

function pick<T>(random: Random, choices: readonly T[]): T {
  return choices[Math.floor(random() * choices.length)]!;
}

// Mulberry32 uses only specified 32-bit operations, so a saved seed is portable.
function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function freshSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
  }
  return (Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0;
}

const recipes: readonly Recipe[] = [
  {
    family: "binary-search",
    title: "Find an insertion point",
    description:
      "Lower-bound search in a sorted integer sequence, including duplicate values.",
    render(language, random) {
      const name = pick(random, ["offsets", "scores", "prices"]);
      if (language === "python")
        return `def locate_${name}(${name}, target):
    left, right = 0, len(${name})
    while left < right:
        middle = (left + right) // 2
        if ${name}[middle] < target:
            left = middle + 1
        else:
            right = middle
    return left`;
      return `class Search {
    static int locate(int[] ${name}, int target) {
        int left = 0, right = ${name}.length;
        while (left < right) {
            int mid = left + (right - left) / 2;
            if (${name}[mid] < target) left = mid + 1;
            else right = mid;
        }
        return left;
    }
}`;
    },
  },
  {
    family: "euclidean-reduction",
    title: "Reduce a whole-number ratio",
    description:
      "Normalize a nonnegative ratio by its greatest common divisor; reject a zero denominator.",
    render(language, random) {
      const name = pick(random, ["ratio", "fraction", "portion"]);
      if (language === "python")
        return `def reduce_${name}(part, whole):
    if part < 0 or whole <= 0:
        raise ValueError("invalid ratio")
    left, right = part, whole
    while right:
        left, right = right, left % right
    return part // left, whole // left`;
      return `class Ratio {
    static long[] ${name}(long part, long whole) {
        if (part < 0 || whole <= 0) throw new IllegalArgumentException();
        long a = part, b = whole;
        while (b != 0) {
            long rest = a % b;
            a = b;
            b = rest;
        }
        return new long[] {part / a, whole / a};
    }
}`;
    },
  },
  {
    family: "sliding-window",
    title: "Compute rolling averages",
    description:
      "Maintain a running total to compute all complete fixed-width windows in linear time.",
    render(language, random) {
      const width = pick(random, [3, 4, 5, 7]);
      const name = pick(random, ["readings", "samples", "prices"]);
      if (language === "python")
        return `def rolling_${name}(${name}, width=${width}):
    if width <= 0:
        raise ValueError("window width must be positive")
    if width > len(${name}):
        return []
    total = sum(${name}[:width])
    averages = [total / width]
    for end in range(width, len(${name})):
        departing = ${name}[end - width]
        arriving = ${name}[end]
        total += arriving - departing
        averages.append(total / width)
    return averages`;
      return `class RollingAverage {
    static double[] average(double[] ${name}, int width) {
        if (width <= 0) {
            throw new IllegalArgumentException("window width must be positive");
        }
        if (width > ${name}.length) return new double[0];
        double total = 0;
        for (int index = 0; index < width; index++) total += ${name}[index];
        double[] averages = new double[${name}.length - width + 1];
        averages[0] = total / width;
        for (int end = width; end < ${name}.length; end++) {
            total += ${name}[end] - ${name}[end - width];
            averages[end - width + 1] = total / width;
        }
        return averages;
    }
}`;
    },
  },
  {
    family: "interval-merging",
    title: "Merge overlapping reservations",
    description:
      "Sort and merge valid half-open intervals without modifying the caller’s input.",
    render(language, random) {
      const name = pick(random, ["bookings", "windows", "slots"]);
      const touching = pick(random, [true, false]);
      const operator = touching ? "<=" : "<";
      if (language === "python")
        return `def merge_${name}(${name}):
    ordered = sorted((start, end) for start, end in ${name} if start < end)
    merged = []
    for start, end in ordered:
        if not merged:
            merged.append([start, end])
            continue
        previous_end = merged[-1][1]
        if start ${operator} previous_end:
            merged[-1][1] = max(previous_end, end)
        else:
            merged.append([start, end])
    return merged`;
      return `import java.util.*;

class Reservations {
    static int[][] merge(int[][] ${name}) {
        List<int[]> ordered = new ArrayList<>();
        for (int[] slot : ${name}) {
            if (slot[0] < slot[1]) ordered.add(slot.clone());
        }
        ordered.sort(Comparator.comparingInt(slot -> slot[0]));
        List<int[]> merged = new ArrayList<>();
        for (int[] slot : ordered) {
            if (merged.isEmpty()) {
                merged.add(slot);
                continue;
            }
            int[] last = merged.get(merged.size() - 1);
            if (slot[0] ${operator} last[1]) last[1] = Math.max(last[1], slot[1]);
            else merged.add(slot);
        }
        return merged.toArray(new int[merged.size()][]);
    }
}`;
    },
  },
  {
    family: "run-length-scanning",
    title: "Find repeated character runs",
    description:
      "Return each qualifying contiguous run with its symbol, start offset, and length.",
    render(language, random) {
      const minimum = pick(random, [2, 3, 4]);
      const name = pick(random, ["signal", "message", "sequence"]);
      if (language === "python")
        return `def repeated_runs(${name}, minimum=${minimum}):
    if minimum < 1:
        raise ValueError("minimum run must be positive")
    runs = []
    start = 0
    while start < len(${name}):
        symbol = ${name}[start]
        end = start + 1
        while end < len(${name}) and ${name}[end] == symbol:
            end += 1
        run_length = end - start
        if run_length >= minimum:
            runs.append((symbol, start, run_length))
        start = end
    return runs`;
      return `import java.util.*;

class RepeatedRuns {
    record Run(char symbol, int start, int length) {}

    static List<Run> find(String ${name}, int minimum) {
        if (minimum < 1) throw new IllegalArgumentException("minimum run must be positive");
        List<Run> runs = new ArrayList<>();
        int start = 0;
        while (start < ${name}.length()) {
            char symbol = ${name}.charAt(start);
            int end = start + 1;
            while (end < ${name}.length() && ${name}.charAt(end) == symbol) end++;
            int length = end - start;
            if (length >= minimum) runs.add(new Run(symbol, start, length));
            start = end;
        }
        return runs;
    }
}`;
    },
  },
  {
    family: "frequency-ranking",
    title: "Rank recurring words",
    description:
      "Count case-insensitive ASCII words; rank by frequency and then alphabetically.",
    render(language, random) {
      const limit = pick(random, [3, 5, 8]);
      const name = pick(random, ["notes", "article", "message"]);
      if (language === "python")
        return `import re


def frequent_words(${name}, limit=${limit}):
    if limit < 0:
        raise ValueError("limit must not be negative")
    counts = {}
    for word in re.findall(r"[a-z0-9]+", ${name}.lower()):
        counts[word] = counts.get(word, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    result = []
    for word, count in ranked[:limit]:
        result.append((word, count))
    return result`;
      return `import java.util.*;

class WordRanking {
    static List<Map.Entry<String, Integer>> rank(String ${name}, int limit) {
        if (limit < 0) throw new IllegalArgumentException("limit must not be negative");
        Map<String, Integer> counts = new HashMap<>();
        for (String word : ${name}.toLowerCase(Locale.ROOT).split("[^a-z0-9]+")) {
            if (!word.isEmpty()) counts.merge(word, 1, Integer::sum);
        }
        List<Map.Entry<String, Integer>> ranked = new ArrayList<>(counts.entrySet());
        ranked.sort((left, right) -> {
            int order = Integer.compare(right.getValue(), left.getValue());
            return order != 0 ? order : left.getKey().compareTo(right.getKey());
        });
        return new ArrayList<>(ranked.subList(0, Math.min(limit, ranked.size())));
    }
}`;
    },
  },
  {
    family: "grid-breadth-first-search",
    title: "Find a shortest grid route",
    description:
      "Breadth-first search with obstacle checks, predecessor tracking, and complete route reconstruction.",
    render(language, random) {
      const name = pick(random, ["terrain", "floor", "maze"]);
      const wall = pick(random, ["#", "X", "*"]);
      const horizontalFirst = pick(random, [true, false]);
      const pythonMoves = horizontalFirst
        ? "((0, 1), (1, 0), (0, -1), (-1, 0))"
        : "((1, 0), (0, 1), (-1, 0), (0, -1))";
      const javaMoves = horizontalFirst
        ? "{{0, 1}, {1, 0}, {0, -1}, {-1, 0}}"
        : "{{1, 0}, {0, 1}, {-1, 0}, {0, -1}}";
      if (language === "python")
        return `from collections import deque


def shortest_route(${name}, start, goal, wall="${wall}"):
    if not ${name} or not ${name}[0]:
        return []
    rows, columns = len(${name}), len(${name}[0])
    if any(len(row) != columns for row in ${name}):
        raise ValueError("grid rows must have equal lengths")
    for row, column in (start, goal):
        if not (0 <= row < rows and 0 <= column < columns):
            raise ValueError("endpoint outside grid")
        if ${name}[row][column] == wall:
            return []
    frontier = deque([start])
    previous = {start: None}
    directions = ${pythonMoves}
    while frontier:
        current = frontier.popleft()
        if current == goal:
            route = []
            while current is not None:
                route.append(current)
                current = previous[current]
            route.reverse()
            return route
        row, column = current
        for row_step, column_step in directions:
            next_row = row + row_step
            next_column = column + column_step
            if not (0 <= next_row < rows and 0 <= next_column < columns):
                continue
            neighbor = (next_row, next_column)
            if neighbor in previous or ${name}[next_row][next_column] == wall:
                continue
            previous[neighbor] = current
            frontier.append(neighbor)
    return []`;
      return `import java.util.*;

class GridRoute {
    record Cell(int row, int column) {}

    static List<Cell> shortest(char[][] ${name}, Cell start, Cell goal) {
        if (${name}.length == 0 || ${name}[0].length == 0) return List.of();
        int rows = ${name}.length, columns = ${name}[0].length;
        for (char[] row : ${name}) {
            if (row.length != columns) {
                throw new IllegalArgumentException("grid rows must have equal lengths");
            }
        }
        for (Cell endpoint : List.of(start, goal)) {
            if (endpoint.row() < 0 || endpoint.row() >= rows ||
                    endpoint.column() < 0 || endpoint.column() >= columns) {
                throw new IllegalArgumentException("endpoint outside grid");
            }
            if (${name}[endpoint.row()][endpoint.column()] == '${wall}') return List.of();
        }
        ArrayDeque<Cell> frontier = new ArrayDeque<>();
        Map<Cell, Cell> previous = new HashMap<>();
        frontier.add(start);
        previous.put(start, null);
        int[][] directions = ${javaMoves};
        while (!frontier.isEmpty()) {
            Cell current = frontier.remove();
            if (current.equals(goal)) {
                List<Cell> route = new ArrayList<>();
                for (Cell cell = current; cell != null; cell = previous.get(cell)) {
                    route.add(cell);
                }
                Collections.reverse(route);
                return route;
            }
            for (int[] direction : directions) {
                int row = current.row() + direction[0];
                int column = current.column() + direction[1];
                if (row < 0 || row >= rows || column < 0 || column >= columns) continue;
                if (${name}[row][column] == '${wall}') continue;
                Cell neighbor = new Cell(row, column);
                if (previous.containsKey(neighbor)) continue;
                previous.put(neighbor, current);
                frontier.add(neighbor);
            }
        }
        return List.of();
    }
}`;
    },
  },
  {
    family: "dependency-ordering",
    title: "Schedule dependency-ordered tasks",
    description:
      "Deduplicate dependency edges, choose ready tasks deterministically, and reject cycles with blocked task names.",
    render(language, random) {
      const name = pick(random, ["jobs", "tasks", "modules"]);
      const reverse = pick(random, [true, false]);
      if (language === "python")
        return `import heapq


def order_${name}(${name}, dependencies):
    names = set(${name})
    outgoing = {name: set() for name in names}
    incoming = {name: 0 for name in names}
    for prerequisite, dependent in dependencies:
        if prerequisite not in names or dependent not in names:
            raise ValueError("dependency references an unknown task")
        if dependent not in outgoing[prerequisite]:
            outgoing[prerequisite].add(dependent)
            incoming[dependent] += 1
    ordered_names = sorted(names, reverse=${reverse ? "True" : "False"})
    priority = {name: index for index, name in enumerate(ordered_names)}
    ready = [(priority[name], name) for name in names if incoming[name] == 0]
    heapq.heapify(ready)
    scheduled = []
    while ready:
        _, name = heapq.heappop(ready)
        scheduled.append(name)
        for dependent in outgoing[name]:
            incoming[dependent] -= 1
            if incoming[dependent] == 0:
                heapq.heappush(ready, (priority[dependent], dependent))
    if len(scheduled) != len(names):
        blocked = sorted(name for name in names if incoming[name] > 0)
        raise ValueError("cyclic dependencies block: " + ", ".join(blocked))
    return scheduled`;
      return `import java.util.*;

class DependencyOrder {
    record Edge(String prerequisite, String dependent) {}

    static List<String> schedule(Collection<String> ${name}, List<Edge> dependencies) {
        Set<String> names = new HashSet<>(${name});
        Map<String, Set<String>> outgoing = new HashMap<>();
        Map<String, Integer> incoming = new HashMap<>();
        for (String name : names) {
            outgoing.put(name, new HashSet<>());
            incoming.put(name, 0);
        }
        for (Edge edge : dependencies) {
            if (!names.contains(edge.prerequisite()) || !names.contains(edge.dependent())) {
                throw new IllegalArgumentException("dependency references an unknown task");
            }
            if (outgoing.get(edge.prerequisite()).add(edge.dependent())) {
                incoming.merge(edge.dependent(), 1, Integer::sum);
            }
        }
        PriorityQueue<String> ready = new PriorityQueue<>(${reverse ? "Comparator.reverseOrder()" : "Comparator.naturalOrder()"});
        for (String name : names) {
            if (incoming.get(name) == 0) ready.add(name);
        }
        List<String> scheduled = new ArrayList<>();
        while (!ready.isEmpty()) {
            String name = ready.remove();
            scheduled.add(name);
            for (String dependent : outgoing.get(name)) {
                int remaining = incoming.merge(dependent, -1, Integer::sum);
                if (remaining == 0) ready.add(dependent);
            }
        }
        if (scheduled.size() != names.size()) {
            List<String> blocked = new ArrayList<>();
            for (String name : names) {
                if (incoming.get(name) > 0) blocked.add(name);
            }
            Collections.sort(blocked);
            throw new IllegalArgumentException("cyclic dependencies block: " + String.join(", ", blocked));
        }
        return scheduled;
    }
}`;
    },
  },
];

/** Original recipes; output length is measured after language-specific rendering. */
export const generatorRecipes = recipes.map(
  ({ family, title, description }) => ({
    family,
    title,
    description,
    languages: ["python", "java"] as readonly Language[],
  }),
);

export function generateSnippet(
  language: Language,
  length: Length,
  seed?: number,
): Snippet {
  const actualSeed = seed === undefined ? freshSeed() : seed >>> 0;
  const random = seededRandom(actualSeed);
  const available = recipes
    .map((recipe) => ({ recipe, code: recipe.render(language, random) }))
    .filter(({ code }) => matchesLength(code, length));
  if (available.length === 0) {
    throw new Error(`No ${language} recipe fits the ${length} length bucket`);
  }
  const { recipe, code } = pick(random, available);
  return {
    id: `generated-${language}-${recipe.family}-${actualSeed}`,
    title: recipe.title,
    language,
    scope: "full",
    code,
    origin: "generated",
    description: recipe.description,
    seed: actualSeed,
  };
}
