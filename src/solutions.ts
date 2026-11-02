import type { Snippet } from "./types";

// Copyright (c) 2022 neetcode-gh. MIT; see /THIRD_PARTY_NOTICES.txt.
// Keep this revision in sync with the immutable source links and notices.
const revision = "8fed5f7daa6a517e375a0562d876e4a72dfdafb8";
const upstream = `https://github.com/neetcode-gh/leetcode/blob/${revision}`;

interface SolutionSource {
  slug: string;
  title: string;
  description: string;
  python: string;
  java: string;
  pythonImports?: string;
  javaImports?: string;
}

// These are upstream implementations, not rewritten algorithm examples.
// Only the active optimized implementation is selected for Java's median file.
const sources: SolutionSource[] = [
  {
    slug: "0001-two-sum",
    title: "Two Sum",
    description: "Hash-map lookup for a pair of indices.",
    pythonImports: "from typing import List",
    javaImports: "import java.util.HashMap;",
    python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        prevMap = {}  # val -> index

        for i, n in enumerate(nums):
            diff = target - n
            if diff in prevMap:
                return [prevMap[diff], i]
            prevMap[n] = i`,
    java: `class Solution {

    public int[] twoSum(int[] nums, int target) {
        HashMap<Integer, Integer> prevMap = new HashMap<>();

        for (int i = 0; i < nums.length; i++) {
            int num = nums[i];
            int diff = target - num;

            if (prevMap.containsKey(diff)) {
                return new int[] { prevMap.get(diff), i };
            }

            prevMap.put(num, i);
        }

        return new int[] {};
    }
}`,
  },
  {
    slug: "0003-longest-substring-without-repeating-characters",
    title: "Longest Substring Without Repeating Characters",
    description: "A moving window over distinct characters.",
    javaImports: "import java.util.ArrayList;\nimport java.util.List;",
    python: `class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        charSet = set()
        l = 0
        res = 0

        for r in range(len(s)):
            while s[r] in charSet:
                charSet.remove(s[l])
                l += 1
            charSet.add(s[r])
            res = max(res, r - l + 1)
        return res`,
    java: `class Solution {

    public int lengthOfLongestSubstring(String s) {
            List<Character> substringL = new ArrayList<>();
            int largestlength = 0;
            for(int right = 0; right < s.length(); right++) {
                if(substringL.contains(s.charAt(right))) {
                    // get the index of the char
                    int index = substringL.indexOf(s.charAt(right));
                    substringL.remove(index);
                    if(index > 0)
                        substringL.subList(0, index).clear();
                }
                substringL.add(s.charAt(right));
                largestlength = Math.max(largestlength, substringL.size());
            }
            return largestlength;
    }
}`,
  },
  {
    slug: "0004-median-of-two-sorted-arrays",
    title: "Median of Two Sorted Arrays",
    description: "Binary-search partitions of two sorted arrays.",
    pythonImports: "from typing import List",
    python: `# Time: log(min(n, m))

class Solution:
    def findMedianSortedArrays(self, nums1: List[int], nums2: List[int]) -> float:
        A, B = nums1, nums2
        total = len(nums1) + len(nums2)
        half = total // 2

        if len(B) < len(A):
            A, B = B, A

        l, r = 0, len(A) - 1
        while True:
            i = (l + r) // 2  # A
            j = half - i - 2  # B

            Aleft = A[i] if i >= 0 else float("-infinity")
            Aright = A[i + 1] if (i + 1) < len(A) else float("infinity")
            Bleft = B[j] if j >= 0 else float("-infinity")
            Bright = B[j + 1] if (j + 1) < len(B) else float("infinity")

            # partition is correct
            if Aleft <= Bright and Bleft <= Aright:
                # odd
                if total % 2:
                    return min(Aright, Bright)
                # even
                return (max(Aleft, Bleft) + min(Aright, Bright)) / 2
            elif Aleft > Bright:
                r = i - 1
            else:
                l = i + 1`,
    java: `/* Optimized solution (Logarithmic) */

// Runtime: O(log(min(m,n)))
// Extra Space: O(1)

class Solution {

    public double findMedianSortedArrays(int[] nums1, int[] nums2) {
        int m = nums1.length;
        int n = nums2.length;

        if (m > n) {
            return findMedianSortedArrays(nums2, nums1);
        }

        int total = m + n;
        int half = (total + 1) / 2;

        int left = 0;
        int right = m;

        var result = 0.0;

        while (left <= right) {
            int i = left + (right - left) / 2;
            int j = half - i;

            // get the four points around possible median
            int left1 = (i > 0) ? nums1[i - 1] : Integer.MIN_VALUE;
            int right1 = (i < m) ? nums1[i] : Integer.MAX_VALUE;
            int left2 = (j > 0) ? nums2[j - 1] : Integer.MIN_VALUE;
            int right2 = (j < n) ? nums2[j] : Integer.MAX_VALUE;

            // partition is correct
            if (left1 <= right2 && left2 <= right1) {
                // even
                if (total % 2 == 0) {
                    result =
                        (Math.max(left1, left2) + Math.min(right1, right2)) /
                        2.0;
                    // odd
                } else {
                    result = Math.max(left1, left2);
                }
                break;
            }
            // partition is wrong (update left/right pointers)
            else if (left1 > right2) {
                right = i - 1;
            } else {
                left = i + 1;
            }
        }

        return result;
    }
}`,
  },
  {
    slug: "0011-container-with-most-water",
    title: "Container With Most Water",
    description: "Two pointers shrink the candidate container.",
    pythonImports: "from typing import List",
    python: `class Solution:
    def maxArea(self, height: List[int]) -> int:
        l, r = 0, len(height) - 1
        res = 0

        while l < r:
            res = max(res, min(height[l], height[r]) * (r - l))
            if height[l] < height[r]:
                l += 1
            elif height[r] <= height[l]:
                r -= 1

        return res`,
    java: `class Solution {

    public int maxArea(int[] height) {
        int left = 0;
        int right = height.length - 1;
        int res = 0;
        while (left < right) {
            int containerLength = right - left;
            int area = containerLength * Math.min(height[left], height[right]);
            res = Math.max(res, area);
            if (height[left] < height[right]) {
                left++;
            } else {
                right--;
            }
        }
        return res;
    }
}`,
  },
  {
    slug: "0014-longest-common-prefix",
    title: "Longest Common Prefix",
    description: "Compare each character position across strings.",
    pythonImports: "from typing import List",
    python: `class Solution:
    def longestCommonPrefix(self, strs: List[str]) -> str:
        for i in range(len(strs[0])):
            for s in strs:
                if i >= len(s) or s[i] != strs[0][i]:
                    return strs[0][:i]
        return strs[0]`,
    java: `class Solution {
    public String longestCommonPrefix(String[] strs) {
        StringBuilder res = new StringBuilder();
        for(int i = 0; i < strs[0].length(); i++) {
            for(String s: strs)
                if(i == s.length() || s.charAt(i) != strs[0].charAt(i))
                    return res.toString();
            res.append(strs[0].charAt(i));
        }
        return res.toString();
    }
}`,
  },
  {
    slug: "0026-remove-duplicates-from-sorted-array",
    title: "Remove Duplicates from Sorted Array",
    description: "Compact distinct values in place with two indices.",
    pythonImports: "from typing import List",
    python: `class Solution:
    def removeDuplicates(self, nums: List[int]) -> int:
        L = 1

        for R in range(1, len(nums)):
            if nums[R] != nums[R - 1]:
                nums[L] = nums[R]
                L += 1
        return L`,
    java: `class Solution {
    public int removeDuplicates(int[] nums) {
        int swap = 1;

        for(int i=1; i<nums.length; i++) {
            if(nums[i] != nums[i-1]) {
                nums[swap] = nums[i];
                swap++;
            }
        }

        return swap;
    }
}`,
  },
  {
    slug: "0033-search-in-rotated-sorted-array",
    title: "Search in Rotated Sorted Array",
    description: "Binary search identifies the sorted side of a rotation.",
    pythonImports: "from typing import List",
    python: `class Solution:
    def search(self, nums: List[int], target: int) -> int:
        l, r = 0, len(nums) - 1

        while l <= r:
            mid = (l + r) // 2
            if target == nums[mid]:
                return mid

            # left sorted portion
            if nums[l] <= nums[mid]:
                if target > nums[mid] or target < nums[l]:
                    l = mid + 1
                else:
                    r = mid - 1
            # right sorted portion
            else:
                if target < nums[mid] or target > nums[r]:
                    r = mid - 1
                else:
                    l = mid + 1
        return -1`,
    java: `class Solution {
    public int search(int[] nums, int target) {

        int l = 0;
        int r = nums.length - 1;

        while(l<=r){

            int mid = (l+r)/2;

            if(nums[mid] == target){
                return mid;
            }
            //left sorted
            if(nums[l]<=nums[mid]){
                if(target > nums[mid] || target < nums[l]){
                    l = mid + 1;
                }else{
                    r = mid - 1;
                }
            }else{//right sorted
                if(target < nums[mid] || target > nums [r]){
                    r = mid - 1;
                }else{
                    l = mid + 1;
                }
            }

        }

        return -1;
    }
}`,
  },
  {
    slug: "0039-combination-sum",
    title: "Combination Sum",
    description:
      "Backtracking accumulates reusable candidates toward a target.",
    pythonImports: "from typing import List",
    javaImports: "import java.util.ArrayList;\nimport java.util.List;",
    python: `class Solution:
    def combinationSum(self, candidates: List[int], target: int) -> List[List[int]]:
        res = []

        def dfs(i, cur, total):
            if total == target:
                res.append(cur.copy())
                return
            if i >= len(candidates) or total > target:
                return

            cur.append(candidates[i])
            dfs(i, cur, total + candidates[i])
            cur.pop()
            dfs(i + 1, cur, total)

        dfs(0, [], 0)
        return res`,
    java: `class Solution {

    public List<List<Integer>> combinationSum(int[] candidates, int target) {
        List<List<Integer>> ans = new ArrayList<List<Integer>>();
        List<Integer> cur = new ArrayList();
        backtrack(candidates, target, ans, cur, 0);
        return ans;
    }

    public void backtrack(
        int[] candidates,
        int target,
        List<List<Integer>> ans,
        List<Integer> cur,
        int index
    ) {
        if (target == 0) {
            ans.add(new ArrayList(cur));
        } else if (target < 0 || index >= candidates.length) {
            return;
        } else {
            cur.add(candidates[index]);
            backtrack(candidates, target - candidates[index], ans, cur, index);

            cur.remove(cur.get(cur.size() - 1));
            backtrack(candidates, target, ans, cur, index + 1);
        }
    }
}`,
  },
];

function withImports(code: string, imports?: string): string {
  return imports ? `${imports}\n\n${code}` : code;
}

// All curated sources have one Solution class. Keep every member together:
// Java Combination Sum needs backtrack; Python keeps its nested dfs helper.
function methodExcerpt(source: string, language: "python" | "java"): string {
  const wrapper =
    language === "python" ? "class Solution:\n" : "class Solution {\n";
  const start = source.indexOf(wrapper);
  const header = source.slice(0, start);
  const body = source.slice(
    start + wrapper.length,
    language === "java" ? source.lastIndexOf("\n}") : undefined,
  );
  return header + body.replace(/^ {4}/gm, "").trim();
}

export const solutions: Snippet[] = sources.flatMap((source) =>
  (["python", "java"] as const).flatMap((language) => {
    const code = source[language];
    const imports =
      language === "python" ? source.pythonImports : source.javaImports;
    const extension = language === "python" ? "py" : "java";
    return (["method", "full"] as const).map((scope): Snippet => ({
      id: `solution-${source.slug}-${language}-${scope}`,
      title: source.title,
      language,
      scope,
      code:
        scope === "full"
          ? withImports(code, imports)
          : withImports(
              methodExcerpt(code, language),
              language === "python" ? imports : undefined,
            ),
      origin: "solution",
      description: `${source.description} ${
        scope === "full"
          ? "Complete Solution class with required imports; no execution harness."
          : "Solution class method excerpt, including any helper methods; not a standalone program."
      } Source: neetcode-gh/leetcode (MIT).`,
      sourceUrl: `${upstream}/${language}/${source.slug}.${extension}`,
      license: "MIT",
    }));
  }),
);
