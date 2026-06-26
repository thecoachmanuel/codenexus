import { connectDB } from "./mongodb";
import Plan from "./models/Plan";

const DEFAULT_PLANS = [
  {
    key: "free",
    label: "Free",
    description: "Start building. No credit card required.",
    price: 0,
    credits: 10,
    featured: false,
    features: ["10 credits / month", "Live preview", "Export to zip"],
  },
  {
    key: "starter",
    label: "Starter",
    description: "For developers who build regularly.",
    price: 9,
    credits: 50,
    featured: true,
    features: [
      "50 credits / month",
      "Image uploads",
      "Live preview",
      "Export to zip",
    ],
  },
  {
    key: "pro",
    label: "Pro",
    description: "For power users who ship fast.",
    price: 29,
    credits: 150,
    featured: false,
    features: [
      "150 credits / month",
      "Priority AI (faster response)",
      "Live preview",
      "Export to zip",
      "Image uploads",
      "GitHub repo import",
      "Access to Crevo Pro Agent",
    ],
  },
];

export async function getPlans() {
  await connectDB();
  
  let plans = await Plan.find().sort({ price: 1 });
  
  // Seed if empty
  if (plans.length === 0) {
    plans = await Plan.insertMany(DEFAULT_PLANS);
  }
  
  return plans;
}

export async function getPlanByKey(key: string) {
  const plans = await getPlans();
  return plans.find((p) => p.key === key);
}
