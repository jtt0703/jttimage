export const loader = async () => {
  return Response.json({
    ok: true,
    service: "lens-cart-ai",
    timestamp: new Date().toISOString(),
  });
};
