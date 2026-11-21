use serde::Serialize;

/// Consumo de un proceso en un instante.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    pub pid: u32,
    pub memory_bytes: u64,
    pub cpu_percent: f32,
}

/// Estado global de la máquina.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemUsage {
    pub cores: u32,
    pub cpu_percent: f32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceUsage {
    /// Proceso de la app (backend de Tauri).
    pub app: Option<ProcessUsage>,
    /// Proceso `opencode serve` del workspace, si está arrancado.
    pub workspace: Option<ProcessUsage>,
    pub system: SystemUsage,
}

#[cfg(not(target_os = "linux"))]
impl ResourceUsage {
    fn empty() -> Self {
        Self {
            app: None,
            workspace: None,
            system: SystemUsage {
                cores: std::thread::available_parallelism()
                    .map(|value| value.get() as u32)
                    .unwrap_or(1),
                cpu_percent: 0.0,
                memory_total_bytes: 0,
                memory_used_bytes: 0,
            },
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::time::Duration;

    use super::{ProcessUsage, ResourceUsage, SystemUsage};

    #[derive(Clone, Copy)]
    struct ProcSample {
        ticks: u64,
        rss_bytes: u64,
    }

    fn read_proc(pid: u32) -> Option<ProcSample> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let end = stat.rfind(')')?;
        let fields: Vec<&str> = stat[end + 1..].split_whitespace().collect();
        // Tras `comm`, el índice 0 es el campo 3 (`state`): utime=14, stime=15.
        let utime: u64 = fields.get(11)?.parse().ok()?;
        let stime: u64 = fields.get(12)?.parse().ok()?;

        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
        let rss_kb: u64 = status
            .lines()
            .find_map(|line| line.strip_prefix("VmRSS:"))?
            .trim()
            .trim_end_matches(" kB")
            .parse()
            .ok()?;

        Some(ProcSample {
            ticks: utime + stime,
            rss_bytes: rss_kb * 1024,
        })
    }

    fn read_cpu() -> Option<(u64, u64)> {
        let stat = std::fs::read_to_string("/proc/stat").ok()?;
        let line = stat.lines().find(|line| line.starts_with("cpu "))?;
        let values: Vec<u64> = line
            .split_whitespace()
            .skip(1)
            .filter_map(|value| value.parse().ok())
            .collect();
        if values.len() < 4 {
            return None;
        }
        let total: u64 = values.iter().sum();
        let idle = values[3] + values.get(4).copied().unwrap_or(0);
        Some((total, idle))
    }

    fn read_memory() -> (u64, u64) {
        let Ok(minfo) = std::fs::read_to_string("/proc/meminfo") else {
            return (0, 0);
        };
        let mut total = 0;
        let mut available = 0;
        for line in minfo.lines() {
            let value = || {
                line.split_whitespace()
                    .nth(1)
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(0)
                    * 1024
            };
            if line.starts_with("MemTotal:") {
                total = value();
            } else if line.starts_with("MemAvailable:") {
                available = value();
            }
        }
        (total, total.saturating_sub(available))
    }

    pub async fn snapshot(workspace_pid: Option<u32>) -> ResourceUsage {
        let app_pid = std::process::id();
        let first_app = read_proc(app_pid);
        let first_workspace = workspace_pid.and_then(read_proc);
        let first_cpu = read_cpu();

        let started = std::time::Instant::now();
        tokio::time::sleep(Duration::from_millis(120)).await;
        let elapsed = started.elapsed().as_secs_f32().max(0.001);

        let second_app = read_proc(app_pid);
        let second_workspace = workspace_pid.and_then(read_proc);
        let second_cpu = read_cpu();
        let (memory_total, memory_used) = read_memory();

        // USER_HZ es 100 en Linux: porcentaje = Δticks / segundos.
        let cpu = |before: Option<ProcSample>, after: Option<ProcSample>, pid: u32| {
            let (before, after) = (before?, after?);
            let ticks = after.ticks.saturating_sub(before.ticks) as f32;
            Some(ProcessUsage {
                pid,
                memory_bytes: after.rss_bytes,
                cpu_percent: (ticks / elapsed).clamp(0.0, 100.0 * 64.0),
            })
        };

        let system_cpu = match (first_cpu, second_cpu) {
            (Some((total_1, idle_1)), Some((total_2, idle_2))) => {
                let total = total_2.saturating_sub(total_1) as f32;
                let idle = idle_2.saturating_sub(idle_1) as f32;
                if total <= 0.0 {
                    0.0
                } else {
                    ((1.0 - idle / total) * 100.0).clamp(0.0, 100.0)
                }
            }
            _ => 0.0,
        };

        ResourceUsage {
            app: cpu(first_app, second_app, app_pid),
            workspace: workspace_pid.and_then(|pid| cpu(first_workspace, second_workspace, pid)),
            system: SystemUsage {
                cores: std::thread::available_parallelism()
                    .map(|value| value.get() as u32)
                    .unwrap_or(1),
                cpu_percent: system_cpu,
                memory_total_bytes: memory_total,
                memory_used_bytes: memory_used,
            },
        }
    }
}

/// Mide CPU y memoria de la app y del servidor del workspace.
///
/// La muestra se toma dos veces separadas 120 ms para poder calcular el uso
/// instantáneo de CPU. En plataformas sin `/proc` devuelve solo lo básico.
pub async fn snapshot(workspace_pid: Option<u32>) -> ResourceUsage {
    #[cfg(target_os = "linux")]
    {
        linux::snapshot(workspace_pid.filter(|pid| *pid > 0)).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = workspace_pid;
        ResourceUsage::empty()
    }
}
