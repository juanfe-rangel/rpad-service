import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class ChatMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(120) id!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) senderId!: string;
  @IsString() @MaxLength(10000) content!: string;
  @IsDateString() timestamp!: string;
}

export class ChatSnapshotDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

export class CreateReportDto {
  @IsString() @IsNotEmpty() @MaxLength(120) claimantId!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) providerId!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) chatId!: string;
  @IsString() @MinLength(10) @MaxLength(5000) description!: string;
  @IsOptional() @ValidateNested() @Type(() => ChatSnapshotDto) chatSnapshot?: ChatSnapshotDto;
}

export class DecisionActionDto {
  @IsIn(['SANCTION', 'RESTORATION']) type!: 'SANCTION' | 'RESTORATION';
  @IsString() @IsNotEmpty() @MaxLength(120) targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) description!: string;
}

export class CreateDecisionDto {
  @IsIn(['CLAIMANT_FAVORED', 'PROVIDER_FAVORED', 'NO_FAULT']) outcome!: 'CLAIMANT_FAVORED' | 'PROVIDER_FAVORED' | 'NO_FAULT';
  @IsString() @MinLength(10) @MaxLength(5000) justification!: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => DecisionActionDto)
  actions!: DecisionActionDto[];
}

export class UploadIntentDto {
  @IsString() @IsNotEmpty() @MaxLength(200) originalFilename!: string;
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']) mimeType!: string;
  @IsInt() @Min(1) @Max(262144000) sizeBytes!: number;
}

export class PurgeConfirmationDto {
  @IsString() @IsNotEmpty() @MaxLength(120) sourceService!: string;
  @IsOptional() @IsString() @MaxLength(1000) confirmationReference?: string;
}

export class ActionResultDto {
  @IsIn(['SUCCEEDED', 'FAILED']) status!: 'SUCCEEDED' | 'FAILED';
  @IsOptional() @IsString() @MaxLength(2000) resultNote?: string;
}
