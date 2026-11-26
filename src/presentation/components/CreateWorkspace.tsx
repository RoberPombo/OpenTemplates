/** Orquesta los cuatro pasos del wizard; el estado vive en `useWizard`. */
import { useWizard, type UseWizardInput } from "../hooks/useWizard";
import type { Library } from "../../types";
import { WIZARD_STEPS as STEPS, WizardFooter, WizardShell, WizardStepper } from "./wizard/chrome";
import { NameStep } from "./wizard/NameStep";
import { ProfileStep } from "./wizard/ProfileStep";
import { RepoStep } from "./wizard/RepoStep";
import { SummaryStep } from "./wizard/SummaryStep";

type Props = UseWizardInput & { library: Library; onClose: () => void };

export function CreateWorkspace(props: Props) {
  const { repos, profiles, library, onClose } = props;
  const wizard = useWizard(props);

  return (
    <WizardShell
      onClose={onClose}
      error={wizard.error}
      stepper={<WizardStepper steps={STEPS} step={wizard.step} onSelect={wizard.goToStep} />}
      footer={
        <WizardFooter
          step={wizard.step}
          steps={STEPS.length}
          name={wizard.name}
          submitting={wizard.submitting}
          canContinue={wizard.canContinue()}
          onBack={wizard.back}
          onNext={wizard.next}
          onCreate={() => void wizard.create()}
        />
      }
    >
      {wizard.step === 0 && (
        <RepoStep
          repos={repos}
          loose={wizard.loose}
          repoId={wizard.repoId}
          loosePath={wizard.loosePath}
          onSelectRepo={wizard.selectRepo}
          onSelectLoose={wizard.selectLoose}
          onPickRepo={() => void wizard.pickRepo()}
          onPickLooseFolder={() => void wizard.pickLooseFolder()}
          onLoosePathChange={wizard.setLoosePath}
        />
      )}

      {wizard.step === 1 && (
        <ProfileStep
          profiles={profiles}
          library={library}
          profileId={wizard.profileId}
          quickOpen={wizard.quickOpen}
          quickName={wizard.quickName}
          quickDescription={wizard.quickDescription}
          quickSlug={wizard.quickSlug}
          savingProfile={wizard.savingProfile}
          selectedMcps={wizard.selectedMcps}
          selectedSkills={wizard.selectedSkills}
          onToggleQuickOpen={wizard.toggleQuickOpen}
          onQuickNameChange={wizard.setQuickName}
          onQuickDescriptionChange={wizard.setQuickDescription}
          onCreateQuickProfile={() => void wizard.createQuickProfile()}
          onSelectProfile={wizard.setProfileId}
          onToggleMcp={wizard.toggleMcp}
          onToggleSkill={wizard.toggleSkill}
        />
      )}

      {wizard.step === 2 && (
        <NameStep
          name={wizard.name}
          slug={wizard.slug}
          loose={wizard.loose}
          loosePath={wizard.loosePath}
          repo={wizard.repo}
          mode={wizard.mode}
          branch={wizard.branch}
          base={wizard.base}
          worktreePath={wizard.worktreePath}
          defaultBranch={wizard.defaultBranch}
          defaultPath={wizard.defaultPath}
          fetchRemote={wizard.fetchRemote}
          useExisting={wizard.useExisting}
          principalConflicts={wizard.principalConflicts}
          onNameChange={wizard.setName}
          onModeChange={wizard.setMode}
          onBranchChange={wizard.setBranch}
          onBaseChange={wizard.setBase}
          onWorktreePathChange={wizard.setWorktreePath}
          onToggleFetchRemote={wizard.toggleFetchRemote}
          onToggleUseExisting={wizard.toggleUseExisting}
        />
      )}

      {wizard.step === 3 && (
        <SummaryStep
          name={wizard.name}
          loose={wizard.loose}
          loosePath={wizard.loosePath}
          repo={wizard.repo}
          mode={wizard.mode}
          worktreePath={wizard.worktreePath}
          defaultPath={wizard.defaultPath}
          branch={wizard.branch}
          base={wizard.base}
          defaultBranch={wizard.defaultBranch}
          profile={wizard.profile}
          selectedMcps={wizard.selectedMcps}
          selectedSkills={wizard.selectedSkills}
          pathConflicts={wizard.pathConflicts}
          startNow={wizard.startNow}
          onToggleStartNow={wizard.toggleStartNow}
        />
      )}
    </WizardShell>
  );
}
