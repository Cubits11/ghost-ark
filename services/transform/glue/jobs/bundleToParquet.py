import sys
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from pyspark.sql import functions as F
from pyspark.sql.types import (
    ArrayType,
    LongType,
    MapType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)
from trusted_tenant_source import assert_trusted_tenant_source


ARGS = getResolvedOptions(
    sys.argv,
    [
        "JOB_NAME",
        "TENANT_SLUG",
        "INPUT_PATH",
        "OUTPUT_PATH",
        "DATASET_NAME",
        "RUN_ID",
    ],
)

sc = SparkContext()
glue_context = GlueContext(sc)
spark = glue_context.spark_session
job = Job(glue_context)
job.init(ARGS["JOB_NAME"], ARGS)

schema = StructType(
    [
        StructField("evidenceObjectId", StringType(), False),
        StructField("tenantSlug", StringType(), False),
        StructField("objectUri", StringType(), False),
        StructField("contentSha256", StringType(), False),
        StructField("contentType", StringType(), True),
        StructField("sizeBytes", LongType(), True),
        StructField("classification", StringType(), True),
        StructField("observedAt", TimestampType(), False),
        StructField("claimIds", ArrayType(StringType()), True),
        StructField("lineageEventIds", ArrayType(StringType()), True),
        StructField("metadata", MapType(StringType(), StringType()), True),
    ]
)

dataset_name = ARGS["DATASET_NAME"]
run_id = ARGS["RUN_ID"]
output_path = ARGS["OUTPUT_PATH"].rstrip("/")
tenant_slug = assert_trusted_tenant_source(
    kind="glue",
    declared_tenant_slug=ARGS["TENANT_SLUG"],
    source_name=ARGS["JOB_NAME"],
    input_path=ARGS["INPUT_PATH"],
    output_path=output_path,
)

raw_df = spark.read.schema(schema).json(ARGS["INPUT_PATH"])

projected_df = (
    raw_df.withColumn("tenant_slug", F.lit(tenant_slug))
    .withColumn("dataset_name", F.lit(dataset_name))
    .withColumn("transform_run_id", F.lit(run_id))
    .withColumn("observed_date", F.to_date("observedAt"))
    .withColumn("observed_year", F.year("observedAt"))
    .withColumn("observed_month", F.date_format("observedAt", "MM"))
    .withColumn("canonical_record", F.to_json(F.struct([F.col(c) for c in raw_df.columns])))
    .withColumn("record_sha256", F.sha2("canonical_record", 256))
    .drop("canonical_record")
)

(
    projected_df.repartition("tenant_slug", "dataset_name", "observed_year", "observed_month")
    .write.mode("append")
    .format("parquet")
    .option("compression", "snappy")
    .partitionBy("tenant_slug", "dataset_name", "observed_year", "observed_month")
    .save(output_path)
)

job.commit()
