import React from "react";

const plans = [
  { name: "Single Book", price: "$7", priceId: "price_1" },
  { name: "Pro", price: "$19/mo", priceId: "price_2" },
  { name: "Agency", price: "$49/mo", priceId: "price_3" },
  { name: "Conversion Only", price: "$3 per use", priceId: "price_4" },
];

export default function Upgrade() {
  const handleCheckout = async (priceId: string) => {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ priceId }),
    });

    const data = await res.json();
    window.location.href = data.url;
  };

  return (
    <div style={{ padding: "40px" }}>
      <h1>Upgrade Your Plan</h1>
      <div style={{ display: "flex", gap: "20px" }}>
        {plans.map((plan) => (
          <div key={plan.name} style={{ border: "1px solid #ccc", padding: "20px" }}>
            <h2>{plan.name}</h2>
            <p>{plan.price}</p>
            <button onClick={() => handleCheckout(plan.priceId)}>
              Choose Plan
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
