use crate::ai::{
    providers::{
        get_ollama_models, get_ollama_status, get_openai_compatible_status,
        run_ollama_inference, run_openai_compatible_inference,
        get_llamacpp_status, run_llamacpp_inference, check_llamacpp_availability,
        download_gguf_model, find_model_by_file, find_model_by_name,
        recommend_model_for_system, get_system_ram_gb, DownloadStatus,
    },
    InferenceRequest, InferenceResponse, ModelConfig, ModelProvider, ProviderStatus,
};
use serde::Serialize;
use tauri::{command, Emitter, State};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

// Global state to track active inference sessions
pub struct InferenceState {
    pub active_sessions: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl Default for InferenceState {
    fn default() -> Self {
        Self {
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Get status of all AI providers
#[command]
pub async fn get_ai_providers_status(ollama_endpoint: Option<String>) -> Result<Vec<ProviderStatus>, String> {
    let mut statuses = Vec::new();

    statuses.push(get_ollama_status(ollama_endpoint.as_deref()).await);

    statuses.push(get_llamacpp_status().await);

    Ok(statuses)
}

/// Get available models for a specific provider
#[command]
pub async fn get_provider_models(
    provider: String,
    endpoint: Option<String>,
) -> Result<Vec<ModelConfig>, String> {
    match provider.as_str() {
        "ollama" => get_ollama_models(endpoint.as_deref())
            .await
            .map_err(|e| e.message),
        "llamacpp" => {
            let status = get_llamacpp_status().await;
            Ok(status.available_models)
        }
        "transformerjs" => {
            Ok(vec![])
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Cancel an ongoing inference request
#[command]
pub async fn cancel_inference(
    session_id: String,
    state: State<'_, InferenceState>,
) -> Result<(), String> {
    let mut sessions = state.active_sessions.lock().unwrap();
    if let Some(token) = sessions.remove(&session_id) {
        token.cancel();
        Ok(())
    } else {
        Ok(())
    }
}

/// Run AI inference
#[command]
pub async fn run_ai_inference(
    window: tauri::Window,
    request: InferenceRequest,
    state: State<'_, InferenceState>,
) -> Result<InferenceResponse, String> {
    let cancel_token = CancellationToken::new();
    let session_id = request.session_id.clone();

    {
        let mut sessions = state.active_sessions.lock().unwrap();
        sessions.insert(session_id.clone(), cancel_token.clone());
    }

    // Pre-download LlamaCpp model if missing (with progress events)
    if request.model_config.provider == ModelProvider::LlamaCpp {
        let model_id = &request.model_config.model_id;
        if let Some(model) = find_model_by_file(model_id).or_else(|| find_model_by_name(model_id)) {
            let model_path = crate::ai::providers::get_models_dir_public().join(model.model_file);
            if !model_path.exists() {
                let (tx, mut rx) = tokio::sync::mpsc::channel::<DownloadStatus>(32);
                let w = window.clone();
                let mid = model_id.clone();
                tokio::spawn(async move {
                    while let Some(status) = rx.recv().await {
                        let _ = w.emit("llamacpp-download-progress", serde_json::json!({
                            "modelId": mid,
                            "status": status.status,
                            "progress": status.progress,
                        }));
                    }
                });
                download_gguf_model(model, Some(tx)).await.map_err(|e| e.message)?;
                let _ = window.emit("llamacpp-download-progress", serde_json::json!({
                    "modelId": model_id,
                    "status": "completed",
                    "progress": 1.0,
                }));
            }
        }
    }

    let result = match request.model_config.provider {
        ModelProvider::Ollama => run_ollama_inference(window, &request, cancel_token.clone())
            .await
            .map_err(|e| e.message),
        ModelProvider::OpenAICompatible => run_openai_compatible_inference(&request)
            .await
            .map_err(|e| e.message),
        ModelProvider::LlamaCpp => run_llamacpp_inference(&request)
            .await
            .map_err(|e| e.message),
        ModelProvider::TransformerJS => {
            Err("TransformerJS inference should run in the browser".to_string())
        }
        _ => Err("Provider not yet implemented".to_string()),
    };

    {
        let mut sessions = state.active_sessions.lock().unwrap();
        sessions.remove(&session_id);
    }

    result
}

/// Check if a specific provider is available
#[command]
pub async fn check_provider_availability(
    provider: String,
    endpoint: Option<String>,
) -> Result<bool, String> {
    match provider.as_str() {
        "ollama" => {
            let status = get_ollama_status(endpoint.as_deref()).await;
            Ok(status.is_available)
        }
        "llamacpp" => {
            Ok(check_llamacpp_availability().await)
        }
        "openai-compatible" => {
            if let Some(ep) = endpoint {
                let status = get_openai_compatible_status(&ep, None).await;
                Ok(status.is_available)
            } else {
                Ok(false)
            }
        }
        _ => Ok(false),
    }
}

#[derive(Serialize)]
pub struct LlamaCppRecommendation {
    pub system_ram_gb: u32,
    pub recommended_model_file: String,
    pub recommended_model_name: String,
    pub recommended_size_gb: f64,
    pub models_available: Vec<serde_json::Value>,
}

/// Get system-aware model recommendation for LlamaCpp
#[command]
pub async fn get_llamacpp_recommendation() -> Result<LlamaCppRecommendation, String> {
    let ram_gb = get_system_ram_gb();
    let recommended = recommend_model_for_system();
    let all_models = crate::ai::providers::get_model_registry_safe()
        .iter()
        .map(|m| serde_json::json!({
            "modelFile": m.model_file,
            "name": m.display_name,
            "sizeGb": m.size_bytes as f64 / 1_000_000_000.0,
            "minRamGb": m.min_ram_gb,
            "recommendedRamGb": m.recommended_ram_gb,
            "isDownloaded": std::path::Path::new(
                &crate::ai::providers::get_models_dir_public().join(m.model_file)
            ).exists(),
        }))
        .collect();

    Ok(LlamaCppRecommendation {
        system_ram_gb: ram_gb,
        recommended_model_file: recommended.model_file.to_string(),
        recommended_model_name: recommended.display_name.to_string(),
        recommended_size_gb: recommended.size_bytes as f64 / 1_000_000_000.0,
        models_available: all_models,
    })
}

/// Download a LlamaCpp GGUF model
#[command]
pub async fn download_llamacpp_model(
    window: tauri::Window,
    model_id: String,
) -> Result<(), String> {
    let mid = model_id.clone();
    let model = find_model_by_file(&mid)
        .or_else(|| find_model_by_name(&mid))
        .ok_or_else(|| format!("Unknown model: {}", &mid))?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<DownloadStatus>(32);

    // Spawn the download in a background task
    let window_clone = window.clone();
    let mid_for_spawn = model_id.clone();
    tokio::spawn(async move {
        while let Some(status) = rx.recv().await {
            let payload = serde_json::json!({
                "modelId": mid_for_spawn,
                "status": status.status,
                "progress": status.progress,
            });
            let _ = window_clone.emit("llamacpp-download-progress", payload);
        }
    });

    download_gguf_model(model, Some(tx))
        .await
        .map_err(|e| e.message)?;

    let _ = window.emit(
        "llamacpp-download-progress",
        serde_json::json!({
            "modelId": model_id,
            "status": "completed",
            "progress": 1.0,
        }),
    );

    Ok(())
}
