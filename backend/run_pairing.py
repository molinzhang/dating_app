"""Run the weekly pairing by hand.

Nothing in the API pairs on its own any more — a profile edit or a questionnaire
submission marks the pool dirty, but recommendations only change when this runs.

    python run_pairing.py            # pair now, whatever changed
    python run_pairing.py --if-dirty # skip when nothing changed since last run
    python run_pairing.py --dry-run  # show what would happen, write nothing

Needs DATABASE_URL (from .env or the environment), same as the API.
"""
import sys

from dotenv import load_dotenv

load_dotenv()

import db  # noqa: E402  (must come after load_dotenv)
import matching  # noqa: E402
import orientation  # noqa: E402
from main import _collect_eligible, run_pairing  # noqa: E402


def preview():
    """What the next run would do, without writing anything."""
    eligible, _responses = _collect_eligible()
    if len(eligible) < 2:
        print(f"符合条件的人只有 {len(eligible)} 个，不足两人，不会配对。")
        return
    exclusions = matching.build_exclusions(db.get_dislike_pairs())
    index = matching.build_text_index(eligible)
    assignments = matching.generate_matches(eligible, exclusions, index)
    by_id = {u["id"]: u for u in eligible}
    names = {u["id"]: db.get_user_by_id(u["id"])["display_name"] for u in eligible}

    pools = orientation.split_into_pools(eligible)
    print(f"符合条件：{len(eligible)} 人")
    for (kind, gender), members in sorted(pools.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")):
        label = f"同性·{gender}" if kind == "same" else "异性"
        print(f"  {label:<8} {len(members):>3} 人")

    matched = {uid for a, b, _ in assignments for uid in (a, b)}
    print(f"\n会配成 {len(assignments)} 对，{len(eligible) - len(matched)} 人落单：")
    for a, b, score in sorted(assignments, key=lambda t: -t[2]):
        terms = matching.shared_interest_terms(by_id[a], by_id[b], index)
        extra = f"  共同点: {'、'.join(terms)}" if terms else ""
        print(f"  {names[a]:>6} ↔ {names[b]:<6} {score:.3f}{extra}")
    left = [names[u['id']] for u in eligible if u["id"] not in matched]
    if left:
        print(f"\n落单：{'、'.join(left)}")
    print("\n（--dry-run，什么都没写入）")


def main(argv):
    if "--dry-run" in argv:
        preview()
        return 0
    result = run_pairing(force="--if-dirty" not in argv)
    if result.get("skipped"):
        print(f"没有配对：{result['skipped']}")
        return 0
    print(
        f"配对完成 #{result['cycleId']}："
        f"{result['eligible']} 人参与，{result['paired']} 人配上，"
        f"{result['unmatched']} 人落单，下次刷新 {result['nextRefreshDate']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
