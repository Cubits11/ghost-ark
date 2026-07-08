import sys
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from trusted_tenant_source import assert_trusted_tenant_source


ARGS = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "TENANT_SLUG",
        "INPUT_PATH",
        "OUTPUT_PATH",
        "SOURCE_KIND",
        "RUN_ID",
    ],
)

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(ARGS["JOB_NAME"], ARGS)

input_path = ARGS["INPUT_PATH"]
output_path = ARGS["OUTPUT_PATH"].rstrip("/")
source_kind = ARGS["SOURCE_KIND"]
run_id = ARGS["RUN_ID"]
tenant_slug = assert_trusted_tenant_source(
    kind="glue",
    declared_tenant_slug=ARGS["TENANT_SLUG"],
    source_name=ARGS["JOB_NAME"],
    input_path=input_path,
    output_path=output_path,
)

source_df = spark.read.option("multiLine", "true").json(input_path)

normalized_df = (
    source_df.withColumn("tenant_slug", F.lit(tenant_slug))
    .withColumn("source_kind", F.lit(source_kind))
    .withColumn("transform_run_id", F.lit(run_id))
    .withColumn("observed_at", F.current_timestamp())
    .withColumn("ingest_date", F.to_date("observed_at"))
    .withColumn("canonical_row_json", F.to_json(F.struct([F.col(c) for c in source_df.columns])))
    .withColumn("row_sha256", F.sha2(F.col("canonical_row_json"), 256))
    .drop("canonical_row_json")
)

(
    normalized_df.repartition("tenant_slug", "ingest_date")
    .write.mode("append")
    .format("parquet")
    .partitionBy("tenant_slug", "ingest_date", "source_kind")
    .save(output_path)
)

job.commit()
