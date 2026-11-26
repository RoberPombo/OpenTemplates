import { useEffect, useState } from "react";
import type { UpdateInfo } from "../../domain/repositories/UpdateGateway";
import { useAppContext } from "../context/AppContext";

/**
 * Comprueba actualizaciones al arrancar y expone el estado del diálogo.
 * Un fallo de red o de endpoint no molesta: el puerto devuelve null.
 */
export function useUpdater() {
  const root = useAppContext();
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void root.updates.check().then((info) => {
      if (active && info) setUpdate(info);
      return undefined;
    });
    return () => {
      active = false;
    };
  }, [root]);

  async function install() {
    setInstalling(true);
    setError(null);
    const result = await root.updates.install();
    setInstalling(false);
    if (result.ok) setInstalled(true);
    else setError(result.error);
  }

  function restart() {
    void root.updates.restart();
  }

  function dismiss() {
    setUpdate(null);
    setInstalled(false);
    setError(null);
  }

  return { update, installing, installed, error, install, restart, dismiss };
}
