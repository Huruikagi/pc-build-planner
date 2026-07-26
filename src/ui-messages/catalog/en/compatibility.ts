/** Compatibility check screen text. */
export const compatibility = {
  title: "Compatibility Check",
  idle: "Start a compatibility check.",
  loading: "Checking…",
  resultsLabel: "Individual results",
  missingFieldsLabel: "Missing fields",
  missingCategory: "{side} isn't selected.",
  missingConfirmedValue: "{side}'s value isn't confirmed.",
  unselectedParty: "{side} (not selected)",
  rules: {
    "cpu-motherboard-socket": {
      name: "CPU socket",
      left: "CPU",
      right: "Motherboard",
    },
    "motherboard-memory-ddr": {
      name: "Memory standard",
      left: "Motherboard",
      right: "Memory",
    },
    "cooler-cpu-socket": {
      name: "CPU cooler socket support",
      left: "CPU",
      right: "CPU cooler",
    },
    "case-motherboard-form-factor": {
      name: "Case form factor support",
      left: "Motherboard",
      right: "Case",
    },
    "case-psu-form-factor": {
      name: "Case power supply form factor support",
      left: "Power supply",
      right: "Case",
    },
  },
  reasons: {
    "value-equal": "The standards match.",
    "value-not-equal": "The standards don't match.",
    "value-included": "This is within the supported range.",
    "value-not-included": "This isn't within the supported range.",
    "input-missing": "Required confirmed information is missing.",
  },
  aggregate: {
    compatible: "Compatible",
    incompatible: "Incompatible",
    caution: "Caution",
    unknown: "Can't determine — not enough information",
  },
  empty: {
    "no-build": "No current build is selected. Select some parts.",
    "invalid-reference":
      "The current build contains an invalid reference. Check the build.",
  },
  failure: {
    "corrupt-data": "Saved data is corrupted. Compatibility can't be checked.",
    "unsupported-data":
      "Saved data is in an unsupported format. Compatibility can't be checked.",
    "read-failed": "Couldn't read the data. Compatibility can't be checked.",
  },
} as const;
