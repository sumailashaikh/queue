import * as t from 'c:/Users/ASUS/Salon-App/queue-backend/src/utils/timeUtils';

console.log("--- Test 1: Single Object (Current Behavior, Should Pass) ---");
const bizObj = { open_time: '09:00:00', close_time: '21:00:00', is_closed: false };
console.log("isBusinessOpen:", t.isBusinessOpen(bizObj).isOpen);
console.log("canCompleteBeforeClosing:", t.canCompleteBeforeClosing(bizObj, 30, 30).canJoin);

console.log("\n--- Test 2: Array (Suspected Bug, Should Fail) ---");
const bizArr: any = [{ open_time: '09:00:00', close_time: '21:00:00', is_closed: false }];
try {
    const openRes = t.isBusinessOpen(bizArr);
    console.log("isBusinessOpen:", openRes.isOpen, "(Message:", openRes.message, ")");

    const capRes = t.canCompleteBeforeClosing(bizArr, 30, 30);
    console.log("canCompleteBeforeClosing:", capRes.canJoin, "(Message:", capRes.message, ")");
} catch (e: any) {
    console.log("ERROR:", e.message);
}

console.log("\n--- Test 3: Missing Close Time (Potential Bug) ---");
const bizMissing: any = { open_time: '09:00:00', is_closed: false };
const capRes2 = t.canCompleteBeforeClosing(bizMissing, 30, 30);
console.log("canCompleteBeforeClosing (Missing close_time):", capRes2.canJoin, "(Message:", capRes2.message, ")");
