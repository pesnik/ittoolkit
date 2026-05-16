use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::command;

const PROFILE_SUBDIR: &str = ".ittoolkit";
const PROFILE_FILE: &str = "user_profile.md";
const MAX_FACTS: usize = 30;
const MAX_FACT_CHARS: usize = 240;

fn profile_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let dir = home.join(PROFILE_SUBDIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create profile dir: {}", e))?;
    }
    Ok(dir.join(PROFILE_FILE))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileFact {
    pub id: String,
    pub text: String,
    pub created_at: String,
    pub last_reinforced_at: String,
    #[serde(default = "one")]
    pub reinforcement_count: u32,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    #[serde(default)]
    pub facts: Vec<ProfileFact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ProfileFrontmatter {
    #[serde(default)]
    facts: Vec<ProfileFact>,
    #[serde(default, rename = "lastUpdatedAt", skip_serializing_if = "Option::is_none")]
    last_updated_at: Option<String>,
}

fn read_profile_from_disk() -> Result<UserProfile, String> {
    let path = profile_path()?;
    if !path.exists() {
        return Ok(UserProfile::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Read failed: {}", e))?;
    let stripped = match content.strip_prefix("---\n") {
        Some(s) => s,
        None => return Ok(UserProfile::default()),
    };
    let end_marker = stripped
        .find("\n---\n")
        .or_else(|| stripped.find("\n---"))
        .ok_or_else(|| "Profile frontmatter not terminated".to_string())?;
    let yaml_str = &stripped[..end_marker];
    let fm: ProfileFrontmatter =
        serde_yaml::from_str(yaml_str).map_err(|e| format!("Profile parse error: {}", e))?;
    Ok(UserProfile {
        facts: fm.facts,
        last_updated_at: fm.last_updated_at,
    })
}

fn write_profile_to_disk(profile: &UserProfile) -> Result<(), String> {
    let path = profile_path()?;
    let fm = ProfileFrontmatter {
        facts: profile.facts.clone(),
        last_updated_at: profile.last_updated_at.clone(),
    };
    let yaml = serde_yaml::to_string(&fm)
        .map_err(|e| format!("Failed to serialize profile: {}", e))?;
    let mut out = String::with_capacity(yaml.len() + 64);
    out.push_str("---\n");
    out.push_str(&yaml);
    if !yaml.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n\n");
    out.push_str("# User Profile\n\nDurable facts the assistant uses across conversations. Edit the YAML above directly to remove anything you don't want remembered.\n");
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, out).map_err(|e| format!("Profile write tmp failed: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Profile rename failed: {}", e))
}

#[command]
pub fn load_user_profile() -> Result<UserProfile, String> {
    read_profile_from_disk()
}

#[command]
pub fn save_user_profile(profile: UserProfile) -> Result<UserProfile, String> {
    let mut next = profile;
    next.last_updated_at = Some(Utc::now().to_rfc3339());
    write_profile_to_disk(&next)?;
    Ok(next)
}

/// Merge a batch of newly-extracted fact texts into the profile. Reinforces
/// duplicates by case-insensitive match instead of inserting twice. Caps the
/// total at MAX_FACTS by dropping the least-recently reinforced.
#[command]
pub fn merge_user_profile_facts(facts: Vec<String>) -> Result<UserProfile, String> {
    let mut profile = read_profile_from_disk().unwrap_or_default();
    let now = Utc::now().to_rfc3339();
    for raw in facts {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let truncated: String = trimmed.chars().take(MAX_FACT_CHARS).collect();
        let lower = truncated.to_lowercase();
        if let Some(existing) = profile
            .facts
            .iter_mut()
            .find(|f| f.text.to_lowercase() == lower)
        {
            existing.last_reinforced_at = now.clone();
            existing.reinforcement_count = existing.reinforcement_count.saturating_add(1);
        } else {
            profile.facts.push(ProfileFact {
                id: format!("fact-{}", uuid::Uuid::new_v4().simple()),
                text: truncated,
                created_at: now.clone(),
                last_reinforced_at: now.clone(),
                reinforcement_count: 1,
            });
        }
    }
    if profile.facts.len() > MAX_FACTS {
        profile
            .facts
            .sort_by(|a, b| b.last_reinforced_at.cmp(&a.last_reinforced_at));
        profile.facts.truncate(MAX_FACTS);
    }
    profile.last_updated_at = Some(now);
    write_profile_to_disk(&profile)?;
    Ok(profile)
}
