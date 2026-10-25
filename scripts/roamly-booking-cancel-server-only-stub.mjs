// Test-only stub for the "server-only" marker package, which is imported
// transitively (via travelMarketSearch) but is not a declared dependency.
// It has no runtime exports; importing it is a marker side effect only.
export default {};
