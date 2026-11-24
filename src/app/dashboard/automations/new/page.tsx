import { getAutomationFormOptions } from "@/server/dashboard/read-model";
import { AvailabilityState, PageHeader } from "../../ui";
import { AutomationForm } from "../automation-form";

export default async function NewAutomationPage() {
  const options = await getAutomationFormOptions();
  return (
    <div className="page-stack narrow-page">
      <PageHeader
        eyebrow="Novo rascunho"
        title="Criar automação"
        description="Defina a regra e a mensagem. A criação termina sempre em DRAFT e não inicia qualquer envio."
      />
      {options.account && options.posts.length ? (
        <AutomationForm
          accountUsername={options.account.username}
          posts={options.posts}
        />
      ) : (
        <AvailabilityState
          availability={options.availability}
          emptyTitle="Sem publicações disponíveis"
        />
      )}
    </div>
  );
}
