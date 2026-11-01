//! Related-data selection and exhaustive canonical-encoding checks.

use coder_core::wsrelated::Config;

const PATHS: &[&str] = &[
    "template",
    "latest_build",
    "latest_build.job",
    "latest_build.job.queue_position",
    "latest_build.resources",
    "latest_build.resources.metadata",
    "latest_build.resources.agents",
    "latest_build.resources.agents.apps",
    "latest_build.resources.agents.apps.statuses",
    "latest_build.resources.agents.scripts",
    "latest_build.resources.agents.log_sources",
    "latest_build.template_version",
];

#[test]
fn absent_empty_and_wildcard_queries_are_distinct() {
    assert_eq!(Config::from_query(None).unwrap(), Config::all());
    assert_eq!(Config::from_query(Some("")).unwrap(), Config::default());
    assert_eq!(Config::parse("*").unwrap(), Config::all());
    assert_eq!(
        Config::parse("latest_build.*").unwrap(),
        Config::all_latest_build()
    );
    assert!(!Config::default().app_statuses());
    assert!(Config::all().app_statuses());
}

#[test]
fn selections_include_ancestors_without_unrequested_siblings() {
    let config = Config::parse("latest_build.resources.agents.apps.statuses").unwrap();
    for path in [
        "latest_build",
        "latest_build.resources",
        "latest_build.resources.agents",
        "latest_build.resources.agents.apps",
        "latest_build.resources.agents.apps.statuses",
    ] {
        assert!(config.contains(path), "{path}");
    }
    for path in [
        "template",
        "latest_build.job",
        "latest_build.resources.metadata",
        "latest_build.resources.agents.scripts",
        "latest_build.template_version",
        "unknown",
    ] {
        assert!(!config.contains(path), "{path}");
    }
}

#[test]
fn wildcard_frontiers_follow_go_field_order() {
    assert_eq!(
        Config::parse("latest_build.resources.agents.*")
            .unwrap()
            .query_param(),
        "latest_build.resources.agents.apps.statuses,latest_build.resources.agents.scripts,latest_build.resources.agents.log_sources"
    );
    assert_eq!(
        Config::parse("latest_build.job.*,template.*")
            .unwrap()
            .query_param(),
        "template,latest_build.job.queue_position"
    );
    assert_eq!(
        Config::parse(" template , latest_build , ")
            .unwrap()
            .query_param(),
        "template,latest_build"
    );
    assert_eq!(
        Config::parse("latest_build,latest_build.job,latest_build.job")
            .unwrap()
            .query_param(),
        "latest_build.job"
    );
}

#[test]
fn malformed_paths_are_rejected_even_after_a_wildcard() {
    for input in [
        "bogus",
        "template,,template",
        ",template",
        ", ,",
        "latest_build.bogus",
        "latest_build.job.queue_position.bogus",
        "latest_build.*.agents",
        "latest_build..job",
        "*.template",
        "template,bogus",
        "*,bogus",
        "template,,",
        "latest_build.**",
        ".*",
    ] {
        assert!(Config::parse(input).is_err(), "{input}");
    }
    assert_eq!(
        Config::parse(" ,").unwrap_err().to_string(),
        "empty include_related path"
    );
    assert_eq!(
        Config::parse("bad\0path").unwrap_err().to_string(),
        "unknown include_related path \"bad\\0path\""
    );
}

#[test]
fn every_combination_round_trips_and_has_canonical_order() {
    for bits in 0..(1 << PATHS.len()) {
        let input = PATHS
            .iter()
            .enumerate()
            .filter(|(i, _)| bits & (1 << i) != 0)
            .map(|(_, path)| *path)
            .collect::<Vec<_>>()
            .join(",");
        let config = Config::parse(&input).unwrap();
        let canonical = config.query_param();
        assert_eq!(Config::parse(&canonical).unwrap(), config, "{input}");
        assert_eq!(Config::parse(&canonical).unwrap().query_param(), canonical);
        let reverse = input.split(',').rev().collect::<Vec<_>>().join(",");
        assert_eq!(Config::parse(&reverse).unwrap(), config);
    }
}
