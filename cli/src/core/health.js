// A direct JS port of print_health_score's formula in scripts/common.sh,
// so bash and Node ever agree on what a given PASS/WARNING/FAIL tally
// means (see docs/PlatformArchitecture.md section 13).
export function scoreResults(results) {
    let pass = 0;
    let warn = 0;
    let fail = 0;

    for (const { status } of results) {
        if (status === "PASS") pass++;
        else if (status === "WARNING") warn++;
        else if (status === "FAIL") fail++;
    }

    const total = pass + warn + fail;
    const score = total === 0 ? 100 : Math.floor((pass * 100 + warn * 50) / total);

    let verdict;
    if (score >= 90) verdict = "Machine Ready";
    else if (score >= 70) verdict = "Machine Mostly Ready - see warnings above";
    else verdict = "Machine Needs Attention";

    return { pass, warn, fail, total, score, verdict };
}
