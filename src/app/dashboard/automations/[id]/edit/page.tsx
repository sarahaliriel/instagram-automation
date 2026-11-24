import { notFound } from "next/navigation";
import {
  getAutomationFormOptions,
  getPrivateAutomation,
} from "@/server/dashboard/read-model";
import { AvailabilityState, PageHeader } from "../../../ui";
import { AutomationForm } from "../../automation-form";

export default async function EditAutomationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [rule, options] = await Promise.all([
    getPrivateAutomation(id),
    getAutomationFormOptions(),
  ]);
  if (!rule || !rule.editable) notFound();
  return (
    <div className="page-stack narrow-page">
      <PageHeader
        eyebrow={`Rascunho · revisão ${rule.revision}`}
        title="Editar automação"
        description="A revisão é verificada no momento de guardar para impedir alterações concorrentes."
      />
      {options.account && options.posts.length ? (
        <AutomationForm
          accountUsername={options.account.username}
          posts={options.posts}
          draft={{
            id: rule.id,
            revision: rule.revision,
            name: rule.name,
            mediaProviderId: rule.mediaProviderId,
            strategy: rule.strategy,
            keyword: rule.keyword,
            privateMessageTemplate: rule.privateMessageTemplate,
          }}
        />
      ) : (
        <AvailabilityState availability={options.availability} />
      )}
    </div>
  );
}
