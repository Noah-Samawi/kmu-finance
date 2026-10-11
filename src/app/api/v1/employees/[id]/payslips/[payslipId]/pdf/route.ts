import { fileResponse, route } from "@/lib/api";
import { getPayslipPdf } from "@/application/hr/hr";

export const GET = route<{ id: string; payslipId: string }>(["ADMIN", "EMPLOYEE"], async ({ ctx, params }) => {
  const f = await getPayslipPdf(ctx, params.id, params.payslipId);
  return fileResponse(f.data, f.mime, f.name, true);
});
